/* The Plugin Page: the three panes, drawn from what the Plugin Server answers.
   Every piece of data comes from research's own tools through rpc.js, never
   from a constant here, so the page and another Plugin see one research. */
'use strict';

/** The one element of index.html with this id. */
function byId(id) {
  return document.getElementById(id);
}

/** Reach the Plugin Server, then show the Topics, or say why it cannot. */
async function start() {
  try {
    await listTools();
    byId('no-topics').hidden = false;
  } catch (fault) {
    byId('trouble-why').textContent = fault.message;
    byId('trouble').hidden = false;
  }
}

start();
