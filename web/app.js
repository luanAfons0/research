/* The Plugin Page: the three panes, drawn from what the Plugin Server answers.
   Every piece of data comes from research's own tools through rpc.js, never
   from a constant here, so the page and another Plugin see one research.

   The address fragment chooses the view, so a reload, a link or a click on a
   Notice lands on the same place: "#" is the Topic list, "#new" a new Topic,
   "#topic/<id>" one Topic, and "#topic/<id>/edit" its form. */
'use strict';

/** The words and the colour class of each state a last Sweep can be in. */
const SWEEP_STATES = {
  reading: { kind: 'running', words: 'Reading' },
  digesting: { kind: 'running', words: 'Making the Digest' },
  done: { kind: '', words: 'Digest ready' },
  failed: { kind: 'failed', words: 'Sweep failed' },
};
const NEVER_SWEPT = { kind: 'never', words: 'Not swept yet' };

/** The one element of index.html with this id. */
function byId(id) {
  return document.getElementById(id);
}

/** Text as HTML that shows it, and never becomes markup. */
function esc(text) {
  return String(text).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

/** The view an address fragment names. Anything else is the Topic list. */
function viewFor(hash) {
  const path = hash.replace(/^#/, '');
  if (path === 'new') return { name: 'new' };
  const found = /^topic\/(\d+)(\/edit)?$/.exec(path);
  if (found) return { name: found[2] ? 'edit' : 'topic', id: Number(found[1]) };
  return { name: 'index' };
}

/** A time as the page shows it: "today, 14:02" or "3 Oct, 14:02". */
function when(iso) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === new Date().toDateString()) return 'today, ' + time;
  return at.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
}

/** The state of a Topic's last Sweep, as a state word in its colour. */
function lastSweep(topic) {
  const state = SWEEP_STATES[topic.lastSweepState] || NEVER_SWEPT;
  return '<span class="state ' + state.kind + '">' + state.words + '</span>';
}

/** "1 Source" or "3 Sources". */
function counted(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/** The Topic on the screen, whole, as get_topic gave it. */
let shown = null;
/** Which drawing is the latest, so a slow answer never draws over a newer one. */
let drawing = 0;

/** Ask for what the address fragment names, then draw it. */
async function show() {
  const view = viewFor(location.hash);
  const turn = (drawing += 1);
  let topics;
  try {
    topics = (await call('list_topics')).topics;
  } catch (fault) {
    if (turn === drawing) cannotReach(fault);
    return;
  }
  let topic = null;
  let missing = null;
  if (view.id !== undefined) {
    try {
      topic = (await call('get_topic', { id: view.id })).topic;
    } catch (fault) {
      missing = fault;
    }
  }
  if (turn !== drawing) return;
  shown = topic;
  draw(view, topics, topic, missing);
}

function draw(view, topics, topic, missing) {
  byId('trouble').hidden = true;
  byId('app').classList.toggle('index', view.name === 'index');
  byId('index').hidden = view.name !== 'index';
  byId('topic-view').hidden = view.name !== 'topic' && !(view.name === 'edit' && missing);
  byId('form-view').hidden = !(view.name === 'new' || (view.name === 'edit' && !missing));
  hideConfirm();
  drawList(topics);
  drawRail(topics, view.id);
  if (view.name === 'topic' || (view.name === 'edit' && missing)) drawTopic(topic, missing);
  if (view.name === 'new' || (view.name === 'edit' && !missing)) drawForm(topic);
}

/** The Topic list, at "#": one row each, or the empty state. */
function drawList(topics) {
  byId('topic-list').hidden = topics.length === 0;
  byId('new-topic').hidden = topics.length === 0;
  byId('no-topics').hidden = topics.length !== 0;
  byId('rows').innerHTML = topics
    .map(
      (topic) =>
        '<li class="row"><a href="#topic/' +
        topic.id +
        '"><span class="t">' +
        esc(topic.name) +
        '</span><span class="c">' +
        topic.sourceCount +
        '</span><span class="s">' +
        lastSweep(topic) +
        (topic.lastSweepAt
          ? '<br><span class="at">' + esc(when(topic.lastSweepAt)) + '</span>'
          : '') +
        '</span><span class="q' +
        (topic.question ? '' : ' none') +
        '">' +
        (topic.question ? esc(topic.question) : 'No question') +
        '</span></a></li>',
    )
    .join('');
}

/** The rail of Topics, beside every view but the list. */
function drawRail(topics, current) {
  byId('rail-topics').innerHTML = topics
    .map(
      (topic) =>
        '<a class="topic-link" href="#topic/' +
        topic.id +
        '"' +
        (topic.id === current ? ' aria-current="page"' : '') +
        '><span class="name">' +
        esc(topic.name) +
        '</span><span class="count">' +
        topic.sourceCount +
        '</span><span class="last">' +
        lastSweep(topic) +
        (topic.lastSweepAt ? ' · ' + esc(when(topic.lastSweepAt)) : '') +
        '</span></a>',
    )
    .join('');
}

/** One Topic's header, or the sentence that says why it cannot be shown. */
function drawTopic(topic, missing) {
  byId('topic-head').hidden = topic === null;
  byId('topic-trouble').hidden = missing === null;
  if (missing !== null) {
    byId('topic-trouble-why').textContent = missing.message;
    return;
  }
  byId('topic-name').textContent = topic.name;
  const question = byId('topic-question');
  question.textContent =
    topic.question || 'No question. The Digest is written in Brazilian Portuguese.';
  question.classList.toggle('none', !topic.question);
}

/** The form: empty for a new Topic, or filled with the one to edit. */
function drawForm(topic) {
  byId('form-title').textContent = topic ? 'Edit “' + topic.name + '”' : 'New Topic';
  byId('form-submit').textContent = topic ? 'Save' : 'Make Topic';
  byId('form-submit').disabled = false;
  byId('f-name').value = topic ? topic.name : '';
  byId('f-q').value = topic ? topic.question : '';
  byId('f-src').value = topic ? topic.sources.join('\n') : '';
  clearRefusals();
}

/** Say why the page cannot show anything, on the Topic list. */
function cannotReach(fault) {
  byId('app').classList.add('index');
  byId('index').hidden = false;
  byId('topic-view').hidden = true;
  byId('form-view').hidden = true;
  byId('topic-list').hidden = true;
  byId('no-topics').hidden = true;
  byId('trouble-why').textContent = fault.message;
  byId('trouble').hidden = false;
}

function clearRefusals() {
  byId('f-src-err').hidden = true;
  byId('f-src-help').hidden = false;
  byId('f-src').removeAttribute('aria-invalid');
  byId('f-src').removeAttribute('aria-describedby');
  byId('form-error').hidden = true;
}

/** Make the Topic, or change it, with what the form holds. */
async function save(event) {
  event.preventDefault();
  const view = viewFor(location.hash);
  // One address on each line. A blank line is no Source, but the lines keep
  // their numbers, so a refusal points at the line the operator sees.
  const sources = [];
  const lines = [];
  byId('f-src')
    .value.split('\n')
    .forEach((line, at) => {
      if (line.trim() === '') return;
      sources.push(line.trim());
      lines.push(at + 1);
    });
  const given = { name: byId('f-name').value, question: byId('f-q').value, sources: sources };
  clearRefusals();
  byId('form-submit').disabled = true;
  try {
    const answer =
      view.name === 'edit'
        ? await call('update_topic', Object.assign({ id: view.id }, given))
        : await call('create_topic', given);
    location.hash = '#topic/' + answer.topic.id;
  } catch (fault) {
    refused(fault, lines);
  } finally {
    byId('form-submit').disabled = false;
  }
}

/** Show a refusal where it belongs: under the Sources when it names one. */
function refused(fault, lines) {
  const data = fault.data;
  if (data && data.field === 'sources' && lines[data.index] !== undefined) {
    byId('f-src-err-text').innerHTML =
      'Line ' +
      lines[data.index] +
      ' is not an http or https address: <code>' +
      esc(data.address) +
      '</code>. Change it or remove it.';
    byId('f-src-help').hidden = true;
    byId('f-src-err').hidden = false;
    byId('f-src').setAttribute('aria-invalid', 'true');
    byId('f-src').setAttribute('aria-describedby', 'f-src-err');
    return;
  }
  byId('form-error-text').textContent = fault.message;
  byId('form-error').hidden = false;
}

/** Ask, in the page, before a Topic is deleted. */
function askToDelete() {
  if (shown === null) return;
  byId('confirm-what').textContent = 'Delete “' + shown.name + '”?';
  byId('confirm-why').textContent = goesWith(shown);
  byId('confirm').hidden = false;
  byId('confirm-cancel').focus();
}

/** What goes with a deleted Topic, in one sentence. */
function goesWith(topic) {
  const parts = [];
  if (topic.sources.length > 0) parts.push(counted(topic.sources.length, 'Source'));
  if (topic.sweeps.length > 0) parts.push(counted(topic.sweeps.length, 'Sweep'));
  if (parts.length === 0) return 'This cannot be undone.';
  const one = parts.length === 1 && parts[0].startsWith('1 ');
  const verb = one ? ' goes' : ' go';
  return 'Its ' + parts.join(' and ') + verb + ' with it. This cannot be undone.';
}

function hideConfirm() {
  byId('confirm').hidden = true;
}

/** Delete the Topic, once the confirmation is on the screen. */
async function deleteShown() {
  if (shown === null || byId('confirm').hidden) return;
  byId('confirm-delete').disabled = true;
  try {
    await call('delete_topic', { id: shown.id });
    location.hash = '#';
  } catch (fault) {
    byId('confirm-why').textContent = fault.message;
  } finally {
    byId('confirm-delete').disabled = false;
  }
}

function go(hash) {
  location.hash = hash;
}

/** Wire the buttons, then show what the address fragment names. */
async function start() {
  for (const id of ['new-topic', 'new-topic-empty', 'new-topic-rail']) {
    byId(id).addEventListener('click', () => go('#new'));
  }
  byId('edit').addEventListener('click', () => shown && go('#topic/' + shown.id + '/edit'));
  byId('delete').addEventListener('click', askToDelete);
  byId('confirm-cancel').addEventListener('click', hideConfirm);
  byId('confirm-delete').addEventListener('click', deleteShown);
  byId('form').addEventListener('submit', save);
  byId('form-cancel').addEventListener('click', () => {
    const view = viewFor(location.hash);
    go(view.name === 'edit' ? '#topic/' + view.id : '#');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideConfirm();
  });
  window.addEventListener('hashchange', show);
  await show();
}

start();
