// Loaded with `electron -r` when VOZELLA_E2E_BACKGROUND=1, so an e2e run can happen while someone
// is using the machine: every window stays off-screen, out of the taskbar and never takes focus.
// The app and the specs still read the place they asked for, so window logic stays testable. Specs
// that depend on real screen pixels or on window focus cannot run in this mode.
/* eslint-disable @typescript-eslint/no-require-imports -- Electron runs this file through -r, as CommonJS. */
const { app, BrowserWindow } = require('electron');

const OFF_SCREEN = -20000;
const proto = BrowserWindow.prototype;
const showInactive = proto.showInactive;
const setBounds = proto.setBounds;
const setPosition = proto.setPosition;
const getBounds = proto.getBounds;
const getNormalBounds = proto.getNormalBounds;
const getContentBounds = proto.getContentBounds;
const setContentSize = proto.setContentSize;

/** Where each window believes it is. The real position is always off-screen. */
const asked = new WeakMap();
const withAsked = (window, bounds) => ({ ...bounds, ...asked.get(window) });

function showParked() {
  this.setSkipTaskbar(true);
  setPosition.call(this, OFF_SCREEN, OFF_SCREEN);
  showInactive.call(this);
}

proto.show = showParked;
proto.showInactive = showParked;
// Sizes still apply, positions do not: nothing may bring a window back onto the screen.
proto.setBounds = function (bounds, animate) {
  const current = withAsked(this, getBounds.call(this));
  asked.set(this, { x: bounds.x ?? current.x, y: bounds.y ?? current.y });
  setBounds.call(this, { ...bounds, x: OFF_SCREEN, y: OFF_SCREEN }, animate);
};
proto.setPosition = function (x, y) {
  asked.set(this, { x, y });
};
proto.getBounds = function () {
  return withAsked(this, getBounds.call(this));
};
proto.getNormalBounds = function () {
  return withAsked(this, getNormalBounds.call(this));
};
proto.getContentBounds = function () {
  return withAsked(this, getContentBounds.call(this));
};
proto.getPosition = function () {
  const { x, y } = this.getBounds();
  return [x, y];
};
// Parked, the client area comes out 16 by 8 px larger than asked, so correct the window for it.
proto.setContentSize = function (width, height, animate) {
  setContentSize.call(this, width, height, animate);
  const [actualWidth, actualHeight] = this.getContentSize();
  const [outerWidth, outerHeight] = this.getSize();
  if (actualWidth === width && actualHeight === height) return;
  setBounds.call(this, {
    x: OFF_SCREEN,
    y: OFF_SCREEN,
    width: outerWidth - (actualWidth - width),
    height: outerHeight - (actualHeight - height),
  });
};
for (const method of ['center', 'focus', 'moveTop', 'maximize', 'setFullScreen']) {
  proto[method] = () => undefined;
}
// A real minimize hands the activation to another window, and a real restore brings this one back
// with the focus, so both only keep the state the app and the specs read.
const minimized = new WeakSet();
proto.minimize = function () {
  minimized.add(this);
};
proto.restore = function () {
  minimized.delete(this);
};
proto.isMinimized = function () {
  return minimized.has(this);
};
// A window not yet shown keeps its real place until then, so park it from the start.
app.on('browser-window-created', (_event, window) => {
  const { x, y } = getBounds.call(window);
  asked.set(window, { x, y });
  window.setSkipTaskbar(true);
  setPosition.call(window, OFF_SCREEN, OFF_SCREEN);
});
app.focus = () => undefined;
// An off-screen window counts as occluded on Windows, and would stop painting.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
