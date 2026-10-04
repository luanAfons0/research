/* The Plugin Page: the three panes, drawn from what the Plugin Server answers.
   Every piece of data comes from research's own tools through rpc.js, never
   from a constant here, so the page and another Plugin see one research.

   The address fragment chooses the view, so a reload, a link or a click on a
   Notice lands on the same place: "#" is the Topic list, "#new" a new Topic,
   "#topic/<id>" one Topic, and "#topic/<id>/edit" its form. While a Sweep
   runs, the page asks again every few seconds, so the band, the Extracts, the
   rail and the Topic list show where it is.

   The Digest is drawn by markdown.js, which escapes every character before it
   reads any Markdown, so a Digest can never become markup. Each [n] in it is
   then drawn as a button that lights Extract n on the right.

   The form keeps its Sources as a list the operator builds one address at a
   time, or many at once from a paste, and puts in order: the order gives
   each Source the [n] of the next Sweep. The page refuses at once what is not
   an http or https address, or is in the list already; the Plugin Server
   still checks every address, and a refusal of its own shows on the row. */
'use strict';

/** The words and the colour class of each state a last Sweep can be in. */
const SWEEP_STATES = {
  reading: { kind: 'running', words: 'Reading' },
  digesting: { kind: 'running', words: 'Making the Digest' },
  done: { kind: '', words: 'Digest ready' },
  failed: { kind: 'failed', words: 'Sweep failed' },
};
const NEVER_SWEPT = { kind: 'never', words: 'Not swept yet' };

/** How often the page asks again while a Sweep runs. */
const POLL_MS = 2000;

/** The icons the page draws inside the markup it makes, as the mock draws them. */
const ICONS = {
  sweep: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/>',
  trash: '<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9"/>',
  alert: '<path d="M8 1.8l6.5 11.4h-13z"/><path d="M8 6.3v3.2M8 11.4v.1"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.1"/>',
  check: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  dot: '<circle cx="8" cy="8" r="2.4"/>',
  cut:
    '<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/>' +
    '<path d="M5.8 10L12 2.5M10.2 10L4 2.5"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
};

/**
 * How each state of an Extract is drawn: the mark the mock gives it, its
 * icon, and whether a press opens it. One that waits or is being read has no
 * text to open yet.
 */
const EXTRACT_MARKS = {
  read: { m: 'read', icon: 'check', opens: true },
  cut: { m: 'cut', icon: 'cut', opens: true },
  thin: { m: 'thin', icon: 'info', opens: true },
  failed: { m: 'fail', icon: 'alert', opens: true },
  reading: { m: 'reading', icon: 'sweep', opens: false },
  waiting: { m: 'wait', icon: 'dot', opens: false },
};

/**
 * What the failed band says for each reason a Sweep fails with: the line in
 * bold, the sentence under it, and whether it offers to make the Digest
 * again. A reason not listed here is shown as it is.
 */
const FAILURES = {
  'no Digest command is set in RESEARCH_DIGEST_COMMAND': {
    what: 'Sweep failed: no Digest command is set',
    why: (kept) =>
      'Set <code>RESEARCH_DIGEST_COMMAND</code> where the Host starts, ' +
      'then make the Digest again. ' +
      kept,
    again: true,
  },
  'no Source could be read': {
    what: 'Sweep failed: no Source could be read',
    why: () => 'Each Extract on the right says why. Check the addresses, then Sweep again.',
    again: false,
  },
  'the Plugin Server stopped before the Sweep ended': {
    what: 'Sweep failed: the Plugin Server stopped before the Sweep ended',
    why: (kept) => ('Sweep again to read every Source. ' + kept).trim(),
    again: false,
  },
};

/** How a reason starts when the Digest command failed; what it said follows. */
const COMMAND_FAILED = 'the Digest command failed: ';

/** Where the last lines of the command's stderr start, in that reason. */
const IT_SAID = '. It said: ';

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

/** One icon, as markup. */
function icon(name) {
  return '<svg class="i" viewBox="0 0 16 16" aria-hidden="true">' + ICONS[name] + '</svg>';
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
  if (at.toDateString() === new Date().toDateString()) return 'today, ' + clock(iso);
  return day(iso) + ', ' + clock(iso);
}

/** The time of day alone: "14:02". */
function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The day alone: "3 Oct". */
function day(iso) {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
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

/** "1 character" or "6,812 characters". */
function characters(n) {
  return n === 1 ? '1 character' : (n || 0).toLocaleString('en') + ' characters';
}

/** Whether a Sweep in this state still runs. */
function running(state) {
  return state === 'reading' || state === 'digesting';
}

/** The first letter in capitals: "not read: application/pdf" reads "Not read: …". */
function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An address as its host and its path, as the Extracts show it. */
function partsOf(address) {
  try {
    const url = new URL(address);
    return { host: url.host, path: url.pathname + url.search };
  } catch {
    return { host: address, path: '' };
  }
}

/** The Topic on the screen, whole, as get_topic gave it. */
let shown = null;
/** The Sweep on the screen, whole, as get_sweep gave it. */
let shownSweep = null;
/** The Sweep the operator picked, by id, or null for the latest one. */
let chosen = null;
/** The number of the Extract open in the centre, or null. */
let opened = null;
/** The number of the Extract a pressed [n] lights, or null. */
let lit = null;
/** Which drawing is the latest, so a slow answer never draws over a newer one. */
let drawing = 0;
/** The next time the page asks again while a Sweep runs. */
let poll = null;
/** The Sources in the form, in order: what create_topic and update_topic get. */
let draft = [];
/** The rows the last Add put in the list, by index, so only they fade in. */
let fresh = [];
/** The row the last move put in place, by index, so it shows where it went. */
let moved = null;
/** What the Plugin Server refused at the last save, as { index, message }, or null. */
let rowRefusal = null;

/**
 * Ask for what the address fragment names, then draw it. With `quiet`, it
 * draws what changed under the operator, and keeps what they are doing: an
 * open confirmation, the form they type in.
 */
async function show(quiet) {
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
  let sweep = null;
  if (view.id !== undefined) {
    try {
      topic = (await call('get_topic', { id: view.id })).topic;
      const picked = topic.sweeps.find((each) => each.id === chosen) || topic.sweeps[0];
      if (picked) sweep = (await call('get_sweep', { id: picked.id })).sweep;
    } catch (fault) {
      missing = fault;
    }
  }
  if (turn !== drawing) return;
  // The light of an [n] belongs to the Sweep it was pressed in.
  if (sweep === null || shownSweep === null || sweep.id !== shownSweep.id) lit = null;
  shown = topic;
  shownSweep = sweep;
  draw(view, topics, topic, missing, sweep, quiet);
  askAgainWhileRunning(topics, sweep);
}

/** While a Sweep runs anywhere the page shows, ask again in a few seconds. */
function askAgainWhileRunning(topics, sweep) {
  clearTimeout(poll);
  poll = null;
  const live =
    topics.some((topic) => running(topic.lastSweepState)) || (sweep && running(sweep.state));
  if (live) poll = setTimeout(() => show(true), POLL_MS);
}

function draw(view, topics, topic, missing, sweep, quiet) {
  const onTopic = view.name === 'topic' || (view.name === 'edit' && missing);
  const onForm = view.name === 'new' || (view.name === 'edit' && !missing);
  byId('trouble').hidden = true;
  byId('app').classList.toggle('index', view.name === 'index');
  byId('index').hidden = view.name !== 'index';
  byId('topic-view').hidden = !onTopic;
  byId('form-view').hidden = !onForm;
  if (!quiet) {
    hideConfirm();
    byId('sweep-trouble').hidden = true;
  }
  drawList(topics);
  drawRail(topics, view.id);
  drawSide(topic, sweep);
  if (onTopic) drawTopic(topic, missing, sweep);
  if (onForm && !quiet) drawForm(topic);
  byId('form-running').hidden = !(view.name === 'edit' && topic && sweepRuns(topic));
}

/** Whether the latest Sweep of a Topic runs. */
function sweepRuns(topic) {
  return topic.sweeps.length > 0 && running(topic.sweeps[0].state);
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

/** One Topic's header, its Sweep's band and Digest, or an open Extract. */
function drawTopic(topic, missing, sweep) {
  byId('topic-head').hidden = topic === null;
  byId('topic-trouble').hidden = missing === null;
  if (missing !== null) {
    byId('topic-main').hidden = false;
    byId('extract-view').hidden = true;
    byId('running').hidden = true;
    byId('failed').hidden = true;
    byId('digest').hidden = true;
    byId('topic-trouble-why').textContent = missing.message;
    return;
  }
  byId('topic-name').textContent = topic.name;
  const question = byId('topic-question');
  question.textContent =
    topic.question || 'No question. The Digest is written in Brazilian Portuguese.';
  question.classList.toggle('none', !topic.question);

  const sweepNow = byId('sweep-now');
  sweepNow.disabled = sweepRuns(topic) || topic.sources.length === 0;
  sweepNow.title = sweepRuns(topic)
    ? 'A Sweep of this Topic is running. Wait for it to end.'
    : topic.sources.length === 0
      ? 'Add a Source first.'
      : '';

  drawBands(sweep);
  drawDigest(sweep);
  const extract = sweep && opened !== null ? sweep.extracts.find((x) => x.n === opened) : null;
  if (!extract) opened = null;
  byId('topic-main').hidden = Boolean(extract);
  byId('extract-view').hidden = !extract;
  if (extract) drawExtract(topic, sweep, extract);
}

/** The band over the Digest: how far a running Sweep is, or why it failed. */
function drawBands(sweep) {
  const runs = sweep !== null && running(sweep.state);
  byId('running').hidden = !runs;
  byId('failed').hidden = !(sweep && sweep.state === 'failed');
  if (runs) {
    const meter = byId('meter');
    if (sweep.state === 'reading') {
      const finished = sweep.extracts.filter((x) => x.state !== 'waiting' && x.state !== 'reading');
      byId('running-what').textContent =
        'Reading ' + finished.length + ' of ' + counted(sweep.sourceCount, 'Source');
      byId('running-why').textContent =
        'Started at ' + clock(sweep.startedAt) + '. The Digest is made when every Source is read.';
      meter.classList.remove('indeterminate');
      meter.style.setProperty('--done', String(finished.length / sweep.sourceCount));
    } else {
      byId('running-what').textContent = 'Making the Digest';
      byId('running-why').textContent =
        sweep.readCount +
        ' of ' +
        counted(sweep.sourceCount, 'Source') +
        ' were read. A model on a CPU can take a few minutes.';
      meter.classList.add('indeterminate');
    }
  }
  if (sweep && sweep.state === 'failed') {
    const kept =
      sweep.readCount === 0
        ? ''
        : sweep.readCount === 1
          ? 'The 1 Extract this Sweep read is kept.'
          : 'The ' + sweep.readCount + ' Extracts this Sweep read are kept.';
    const failure = failureOf(sweep.reason || '', kept);
    byId('failed-what').textContent = failure.what;
    byId('failed-why').innerHTML = failure.why;
    byId('failed-acts').hidden = !(failure.again && sweep.readCount > 0);
  }
}

/** What the failed band says for a reason: its line, its sentence as markup, and its button. */
function failureOf(reason, kept) {
  const known = FAILURES[reason];
  if (known) return { what: known.what, why: known.why(kept), again: known.again };
  if (reason.startsWith(COMMAND_FAILED)) {
    return {
      what: 'Sweep failed: the Digest command failed',
      why: commandSaid(reason.slice(COMMAND_FAILED.length)),
      again: true,
    };
  }
  return { what: 'Sweep failed: ' + reason, why: esc(kept), again: false };
}

/**
 * Why the Digest command failed, as a sentence, and the last lines of its
 * stderr as code: "It exited with 3. It said: <code>…</code>".
 */
function commandSaid(detail) {
  const at = detail.indexOf(IT_SAID);
  const why = at < 0 ? detail : detail.slice(0, at);
  const sentence = esc(capital(why)).replace(/RESEARCH_DIGEST_COMMAND/g, '<code>$&</code>') + '.';
  if (at < 0) return sentence;
  return sentence + ' It said: <code>' + esc(detail.slice(at + IT_SAID.length)) + '</code>';
}

/** The Digest of the Sweep on the screen, or why there is none yet. */
function drawDigest(sweep) {
  byId('digest').hidden = sweep === null;
  if (sweep === null) return;
  const runs = running(sweep.state);
  const has = !runs && sweep.digest !== null;
  byId('digest-made').textContent = has
    ? 'Made at ' +
      clock(sweep.digestAt) +
      ' from ' +
      sweep.readCount +
      ' of ' +
      counted(sweep.sourceCount, 'Source')
    : 'Sweep of ' + when(sweep.startedAt);
  byId('digest-again-head').hidden = !(has && sweep.state === 'done');
  byId('digest-text').hidden = !has;
  byId('no-digest').hidden = has;
  byId('digest-text').innerHTML = has ? digestMarkup(sweep) : '';
  byId('digest-skeleton').hidden = !runs;
  if (runs) byId('digest').setAttribute('aria-busy', 'true');
  else byId('digest').removeAttribute('aria-busy');
  if (sweep.state === 'reading') byId('digest-words').textContent = 'No Digest yet.';
  else if (sweep.state === 'digesting') {
    byId('digest-words').textContent = 'The model is writing the Digest now.';
  } else {
    byId('digest-words').textContent =
      'This Sweep has no Digest. Open an Extract on the right to read what research kept.';
  }
}

/**
 * The Digest as markup: its Markdown read by markdown.js, then each [n], or
 * [n, m], that names an Extract of this Sweep drawn as a button. Code is left
 * as it is, and so is a number that names no Extract.
 */
function digestMarkup(sweep) {
  let at = 0;
  return renderMarkdown(sweep.digest)
    .split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>|<[^>]*>)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, list) => {
        const numbers = list.split(',').map(Number);
        const extracts = numbers.map((n) => sweep.extracts.find((x) => x.n === n));
        if (extracts.some((extract) => !extract)) return whole;
        return extracts.map((extract) => cite(extract, at++)).join('');
      });
    })
    .join('');
}

/** One [n] of the Digest: a button that lights Extract n, red when it could not be read. */
function cite(extract, at) {
  return (
    '<button type="button" class="cite' +
    (extract.state === 'failed' ? ' bad' : '') +
    '" data-n="' +
    extract.n +
    '" data-at="' +
    at +
    '" aria-label="Extract ' +
    extract.n +
    '" aria-pressed="' +
    String(lit === extract.n) +
    '">' +
    extract.n +
    '</button>'
  );
}

/** One Extract, whole, in the centre. */
function drawExtract(topic, sweep, extract) {
  const parts = partsOf(extract.address);
  byId('extract-back').setAttribute('href', '#topic/' + topic.id);
  byId('extract-n').textContent = String(extract.n);
  byId('extract-host').textContent = parts.host;
  byId('extract-address').textContent = parts.host + parts.path;
  byId('extract-when').textContent =
    'Read at ' + clock(extract.readAt) + ' in the Sweep of ' + day(sweep.startedAt) + '.';
  byId('extract-source').setAttribute('href', extract.address);
  byId('extract-cut').hidden = !extract.cut;
  byId('extract-cut-why').textContent = extract.cut
    ? 'The Digest was made from the first ' +
      extract.cutAt.toLocaleString('en') +
      ' of ' +
      characters(extract.characters) +
      '. The whole text is kept below.'
    : '';
  byId('extract-thin').hidden = extract.state !== 'thin';
  byId('extract-thin-why').textContent =
    'The page gave only ' +
    characters(extract.characters) +
    '. It may make its text with JavaScript, which research does not run.';
  byId('extract-failed').hidden = extract.state !== 'failed';
  byId('extract-failed-what').textContent = capital(extract.reason || '') + '.';
  byId('extract-text').innerHTML = (extract.text || '')
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== '')
    .map((block) => '<p>' + esc(block).replace(/\n/g, '<br>') + '</p>')
    .join('');
}

/** The right pane: the Topic's Sweeps, new to old, and the Extracts of the one on the screen. */
function drawSide(topic, sweep) {
  byId('side-topic').hidden = topic === null;
  if (topic === null) return;
  byId('no-sweeps').hidden = topic.sweeps.length !== 0;
  byId('sweeps').innerHTML = topic.sweeps
    .map((each) => {
      const runs = running(each.state);
      const state = SWEEP_STATES[each.state] || NEVER_SWEPT;
      const words =
        each.state === 'done'
          ? each.readCount + ' of ' + each.sourceCount + ' read'
          : each.state === 'failed'
            ? 'Failed'
            : state.words;
      const at = esc(when(each.startedAt));
      return (
        '<li class="sweep' +
        (sweep && each.id === sweep.id ? ' on' : '') +
        '"><button type="button" class="pick" data-sweep="' +
        each.id +
        '"><span>' +
        at +
        '</span><span class="state ' +
        state.kind +
        '">' +
        words +
        '</span></button><button type="button" class="btn quiet del" data-delete-sweep="' +
        each.id +
        '" aria-label="Delete the Sweep of ' +
        at +
        '"' +
        (runs ? ' disabled title="A running Sweep cannot be deleted."' : '') +
        '>' +
        icon('trash') +
        '</button></li>'
      );
    })
    .join('');
  byId('extracts-part').hidden = sweep === null;
  if (sweep === null) return;
  byId('extracts-count').textContent = sweep.readCount + ' of ' + sweep.sourceCount + ' read';
  byId('extracts').innerHTML = sweep.extracts.map(extractItem).join('');
}

/** One Extract in the right pane, with its number, its address and its mark. */
function extractItem(extract) {
  const look = lookOf(extract);
  const parts = partsOf(extract.address);
  const mark = markOf(extract);
  return (
    '<li class="x' +
    (lit === extract.n ? ' hit' : '') +
    (opened === extract.n ? ' open' : '') +
    '" data-m="' +
    look.m +
    '" data-x="' +
    extract.n +
    '" tabindex="' +
    (look.opens ? 0 : -1) +
    '" role="button" aria-label="Extract ' +
    extract.n +
    ', ' +
    esc(parts.host) +
    ', ' +
    esc(mark) +
    '"><span class="n">' +
    extract.n +
    '</span><span class="host">' +
    esc(parts.host) +
    '</span><span class="path">' +
    esc(parts.path) +
    '</span><span class="mark">' +
    icon(look.icon) +
    esc(mark) +
    '</span></li>'
  );
}

/** How an Extract is drawn: a read one the Digest's prompt cut has a mark of its own. */
function lookOf(extract) {
  if (extract.state === 'read' && extract.cut) return EXTRACT_MARKS.cut;
  return EXTRACT_MARKS[extract.state] || EXTRACT_MARKS.waiting;
}

/** The words under an Extract: how much it read, or why it has no text. */
function markOf(extract) {
  if (extract.state === 'read' && extract.cut) {
    return (
      'Cut: the model read ' +
      extract.cutAt.toLocaleString('en') +
      ' of ' +
      characters(extract.characters)
    );
  }
  if (extract.state === 'read') return characters(extract.characters);
  if (extract.state === 'thin') return extract.note;
  if (extract.state === 'failed') return capital(extract.reason || '');
  if (extract.state === 'reading') return 'Reading now';
  return 'Waiting';
}

/** The form: empty for a new Topic, or filled with the one to edit. */
function drawForm(topic) {
  byId('form-title').textContent = topic ? 'Edit “' + topic.name + '”' : 'New Topic';
  byId('form-submit').textContent = topic ? 'Save' : 'Make Topic';
  byId('form-submit').disabled = false;
  byId('f-name').value = topic ? topic.name : '';
  byId('f-q').value = topic ? topic.question : '';
  draft = topic ? topic.sources.slice() : [];
  byId('f-src-add').value = '';
  clearRefusals();
  drawSources(null);
}

/**
 * The addresses in a piece of text, in order: one on each line, or split by
 * spaces or commas. A comma inside an address stays, unless another address
 * starts right after it.
 */
function addressesIn(text) {
  return text
    .split(/\s+/)
    .flatMap((part) => part.split(/,(?=[a-z][a-z0-9+.-]*:)/i))
    .map((part) => part.replace(/^,+|,+$/g, ''))
    .filter((part) => part !== '');
}

/** An address as the page compares it, so "https://Example.org" is "https://example.org/". */
function sameAs(address) {
  try {
    return new URL(address).href;
  } catch {
    return address;
  }
}

/**
 * Why an address cannot join the list, as markup, or '' when it can. The
 * page checks the start alone; the Plugin Server checks the whole address
 * when the form is saved.
 */
function refusalOf(address) {
  const shown = '<code>' + esc(address) + '</code>';
  if (!/^https?:\/\//i.test(address)) return shown + ' is not an http or https address.';
  if (draft.some((each) => sameAs(each) === sameAs(address))) {
    return shown + ' is already in the list.';
  }
  return '';
}

/**
 * Add each address in the text to the end of the list, in order. What is
 * refused stays in the box after `kept`, so it can be fixed, and the reason
 * shows under it. It says whether every address was added.
 */
function addSources(text, kept) {
  const refused = [];
  const reasons = [];
  const before = draft.length;
  for (const address of addressesIn(text)) {
    const reason = refusalOf(address);
    if (reason === '') draft.push(address);
    else {
      refused.push(address);
      reasons.push(reason);
    }
  }
  fresh = [];
  for (let at = before; at < draft.length; at += 1) fresh.push(at);
  if (draft.length !== before) rowRefusal = null;
  byId('f-src-add').value = [kept.trim()]
    .concat(refused)
    .filter((part) => part !== '')
    .join(' ');
  showAddRefusal(reasons.join(' '));
  drawSources(null);
  return refused.length === 0;
}

/** Say under the box why an address was not added, or say nothing. */
function showAddRefusal(markup) {
  const box = byId('f-src-add');
  byId('f-src-add-err-text').innerHTML = markup;
  byId('f-src-add-err').hidden = markup === '';
  if (markup === '') {
    box.removeAttribute('aria-invalid');
    box.setAttribute('aria-describedby', 'f-src-help');
  } else {
    box.setAttribute('aria-invalid', 'true');
    box.setAttribute('aria-describedby', 'f-src-add-err f-src-help');
  }
}

/** The list of Sources, its count in the label, and focus on `focus`, a selector, if given. */
function drawSources(focus) {
  const list = byId('f-src-list');
  byId('f-src-count').textContent = draft.length === 0 ? '' : '(' + draft.length + ')';
  byId('f-src-none').hidden = draft.length !== 0;
  list.hidden = draft.length === 0;
  list.innerHTML = draft.map(sourceRow).join('');
  fresh = [];
  moved = null;
  if (focus === null) return;
  const item = list.querySelector(focus);
  if (item) item.focus();
}

/**
 * One Source in the form: its number, its address as the Extracts show it,
 * and its buttons. The number is the [n] it gets in the next Sweep.
 */
function sourceRow(address, at) {
  const parts = partsOf(address);
  const bad = rowRefusal !== null && rowRefusal.index === at;
  const named = esc(address);
  return (
    '<li class="src' +
    (fresh.includes(at) ? ' fresh' : '') +
    (moved === at ? ' moved' : '') +
    (bad ? ' bad' : '') +
    '" data-src="' +
    at +
    '"><span class="n">' +
    (at + 1) +
    '</span><span class="host">' +
    esc(parts.host) +
    '</span><span class="path">' +
    esc(parts.path) +
    '</span><span class="src-acts">' +
    sourceButton('up', at, at === 0, 'Move ' + named + ' up') +
    sourceButton('down', at, at === draft.length - 1, 'Move ' + named + ' down') +
    '<button type="button" class="btn quiet" data-remove="' +
    at +
    '" aria-label="Remove ' +
    named +
    '"' +
    (bad ? ' aria-describedby="f-src-row-err"' : '') +
    '>' +
    icon('trash') +
    '</button></span>' +
    (bad
      ? '<span class="src-err" id="f-src-row-err">' +
        icon('alert') +
        '<span>' +
        esc(rowRefusal.message) +
        '</span></span>'
      : '') +
    '</li>'
  );
}

/** One move button of a row; the first row has no up, and the last no down. */
function sourceButton(way, at, off, label) {
  return (
    '<button type="button" class="btn quiet" data-' +
    way +
    '="' +
    at +
    '" aria-label="' +
    label +
    '"' +
    (off ? ' disabled' : '') +
    '>' +
    icon(way) +
    '</button>'
  );
}

/** The index of the row a press or a key came from, and which control it was. */
function sourceTarget(target) {
  if (!target || !target.closest) return null;
  for (const control of ['up', 'down', 'remove', 'src']) {
    const found = target.closest('[data-' + control + ']');
    if (found) return { at: Number(found.getAttribute('data-' + control)), control: control };
  }
  return null;
}

/** Move a Source one place up or down, and keep the focus on the control that moved it. */
function moveSource(at, by, control) {
  const to = at + by;
  if (to < 0 || to >= draft.length) return;
  const [address] = draft.splice(at, 1);
  draft.splice(to, 0, address);
  rowRefusal = null;
  moved = to;
  // A move button at the end of the list is off, so the focus goes to its pair.
  let keep = control === 'src' ? 'remove' : control;
  if (keep === 'up' && to === 0) keep = 'down';
  if (keep === 'down' && to === draft.length - 1) keep = 'up';
  drawSources('[data-' + keep + '="' + to + '"]');
}

/** Remove a Source, and put the focus on the row that takes its place. */
function removeSource(at) {
  draft.splice(at, 1);
  rowRefusal = null;
  if (draft.length === 0) {
    drawSources(null);
    byId('f-src-add').focus();
    return;
  }
  drawSources('[data-remove="' + Math.min(at, draft.length - 1) + '"]');
}

/** A press in the list of Sources: move one, or remove it. */
function onSourceList(event) {
  const pressed = sourceTarget(event.target);
  if (pressed === null) return;
  if (pressed.control === 'up') moveSource(pressed.at, -1, 'up');
  if (pressed.control === 'down') moveSource(pressed.at, 1, 'down');
  if (pressed.control === 'remove') removeSource(pressed.at);
}

/** Alt+ArrowUp and Alt+ArrowDown move the row the focus is in. */
function onSourceKey(event) {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  const from = sourceTarget(event.target);
  if (from === null) return;
  event.preventDefault();
  moveSource(from.at, event.key === 'ArrowUp' ? -1 : 1, from.control);
}

/** Add what the box holds, and keep the focus in it for the next one. */
function addTyped() {
  const box = byId('f-src-add');
  addSources(box.value, '');
  box.focus();
}

/** A paste of more than one address adds each one; a paste of one lands in the box. */
function onSourcePaste(event) {
  const text = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (addressesIn(text).length < 2) return;
  event.preventDefault();
  addSources(text, byId('f-src-add').value);
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
  showAddRefusal('');
  rowRefusal = null;
  byId('form-error').hidden = true;
}

/** Make the Topic, or change it, with what the form holds. */
async function save(event) {
  event.preventDefault();
  const view = viewFor(location.hash);
  clearRefusals();
  // An address still in the box is one the operator means to keep, so it
  // joins the list first. One the page refuses stops the save, with why.
  const box = byId('f-src-add');
  if (box.value.trim() !== '' && !addSources(box.value, '')) {
    box.focus();
    return;
  }
  drawSources(null);
  const given = {
    name: byId('f-name').value,
    question: byId('f-q').value,
    sources: draft.slice(),
  };
  byId('form-submit').disabled = true;
  try {
    const answer =
      view.name === 'edit'
        ? await call('update_topic', Object.assign({ id: view.id }, given))
        : await call('create_topic', given);
    location.hash = '#topic/' + answer.topic.id;
  } catch (fault) {
    refused(fault);
  } finally {
    byId('form-submit').disabled = false;
  }
}

/** Show a refusal where it belongs: on the row of the Source it names. */
function refused(fault) {
  const data = fault.data;
  if (data && data.field === 'sources' && draft[data.index] !== undefined) {
    rowRefusal = { index: data.index, message: fault.message };
    drawSources('[data-remove="' + data.index + '"]');
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

/** Say, over the Digest, what a Sweep tool refused. */
function sweepTrouble(what, fault) {
  byId('sweep-trouble-what').textContent = what;
  byId('sweep-trouble-why').textContent = fault.message;
  byId('sweep-trouble').hidden = false;
}

/** Start a Sweep of the Topic on the screen, and show it as it reads. */
async function sweepNow() {
  if (shown === null) return;
  byId('sweep-now').disabled = true;
  byId('sweep-trouble').hidden = true;
  try {
    await call('sweep_topic', { id: shown.id });
    chosen = null;
    opened = null;
    await show(true);
  } catch (fault) {
    sweepTrouble('The Sweep did not start', fault);
    byId('sweep-now').disabled = false;
  }
}

/** Make the Digest of the Sweep on the screen again, and show it being made. */
async function digestAgain() {
  if (shownSweep === null) return;
  const buttons = [byId('digest-again'), byId('digest-again-head')];
  for (const button of buttons) button.disabled = true;
  byId('sweep-trouble').hidden = true;
  try {
    await call('make_digest', { id: shownSweep.id });
    chosen = shownSweep.id;
    await show(true);
  } catch (fault) {
    sweepTrouble('The Digest was not made', fault);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

/**
 * A press on [n] in the Digest: light Extract n on the right and bring it
 * into view, or put the light out when it is already lit, as the mock does.
 */
function onDigest(event) {
  const pressed = event.target.closest('[data-n]');
  if (!pressed || !shownSweep) return;
  const n = Number(pressed.getAttribute('data-n'));
  lit = lit === n ? null : n;
  byId('digest-text').innerHTML = digestMarkup(shownSweep);
  byId('extracts').innerHTML = shownSweep.extracts.map(extractItem).join('');
  // The Digest was drawn again, so the focus goes back to the [n] pressed.
  const again = byId('digest-text').querySelector(
    '[data-at="' + pressed.getAttribute('data-at') + '"]',
  );
  if (again) again.focus();
  if (lit === null) return;
  const item = byId('extracts').querySelector('[data-x="' + n + '"]');
  if (item) {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    item.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }
}

/** A press in the list of Sweeps: pick one, or delete it. */
async function onSweeps(event) {
  const target = event.target;
  const doomed = target.closest('[data-delete-sweep]');
  if (doomed) {
    byId('sweep-trouble').hidden = true;
    try {
      await call('delete_sweep', { id: Number(doomed.getAttribute('data-delete-sweep')) });
      if (shownSweep && chosen === shownSweep.id) chosen = null;
      opened = null;
      await show(true);
    } catch (fault) {
      sweepTrouble('The Sweep was not deleted', fault);
    }
    return;
  }
  const pick = target.closest('[data-sweep]');
  if (pick) {
    chosen = Number(pick.getAttribute('data-sweep'));
    opened = null;
    await show(true);
  }
}

/** A press on an Extract: open it in the centre, over the Digest. */
function onExtracts(event) {
  const item = event.target.closest('[data-x]');
  if (!item || !shownSweep) return;
  const extract = shownSweep.extracts.find((x) => x.n === Number(item.getAttribute('data-x')));
  if (!extract || !lookOf(extract).opens) return;
  opened = extract.n;
  lit = null;
  const view = viewFor(location.hash);
  if (view.name !== 'topic') {
    go('#topic/' + shown.id);
    return;
  }
  show(true);
  byId('main').scrollTop = 0;
}

/** Close the open Extract, and show the Digest again. */
function closeExtract() {
  if (opened === null) return;
  opened = null;
  show(true);
}

function go(hash) {
  location.hash = hash;
}

/** Wire the buttons, then show what the address fragment names. */
async function start() {
  for (const id of ['new-topic', 'new-topic-empty', 'new-topic-rail']) {
    byId(id).addEventListener('click', () => go('#new'));
  }
  byId('sweep-now').addEventListener('click', sweepNow);
  byId('edit').addEventListener('click', () => shown && go('#topic/' + shown.id + '/edit'));
  byId('delete').addEventListener('click', askToDelete);
  byId('confirm-cancel').addEventListener('click', hideConfirm);
  byId('confirm-delete').addEventListener('click', deleteShown);
  byId('sweeps').addEventListener('click', onSweeps);
  byId('extracts').addEventListener('click', onExtracts);
  byId('digest-text').addEventListener('click', onDigest);
  byId('digest-again').addEventListener('click', digestAgain);
  byId('digest-again-head').addEventListener('click', digestAgain);
  byId('extract-back').addEventListener('click', (event) => {
    event.preventDefault();
    closeExtract();
  });
  byId('form').addEventListener('submit', save);
  byId('f-src-add-button').addEventListener('click', addTyped);
  byId('f-src-add').addEventListener('keydown', (event) => {
    // Enter adds the address. It never sends the form from here.
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTyped();
  });
  byId('f-src-add').addEventListener('paste', onSourcePaste);
  byId('f-src-add').addEventListener('input', () => showAddRefusal(''));
  byId('f-src-list').addEventListener('click', onSourceList);
  byId('f-src-list').addEventListener('keydown', onSourceKey);
  byId('form-cancel').addEventListener('click', () => {
    const view = viewFor(location.hash);
    go(view.name === 'edit' ? '#topic/' + view.id : '#');
  });
  document.addEventListener('keydown', (event) => {
    // An Extract in the list is a button to the keyboard too.
    const item = event.target && event.target.closest ? event.target.closest('[data-x]') : null;
    if (item && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onExtracts(event);
      return;
    }
    if (event.key === 'Escape') {
      hideConfirm();
      closeExtract();
    }
  });
  window.addEventListener('hashchange', () => {
    // Another Topic starts on its latest Sweep, with no Extract open.
    const view = viewFor(location.hash);
    if (!shown || view.id !== shown.id) {
      chosen = null;
      opened = null;
    }
    show(false);
  });
  await show(false);
}

start();
