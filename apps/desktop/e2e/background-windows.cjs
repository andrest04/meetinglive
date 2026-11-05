// Loaded with `electron -r` when VOZELLA_E2E_BACKGROUND=1, so an e2e run can happen while someone
// is using the machine: every window stays off-screen, out of the taskbar and never takes focus.
// Specs that depend on real screen pixels or on window focus cannot run in this mode.
const { app, BrowserWindow } = require('electron');

const OFF_SCREEN = -32000;
const showInactive = BrowserWindow.prototype.showInactive;
const setBounds = BrowserWindow.prototype.setBounds;
const setPosition = BrowserWindow.prototype.setPosition;

function showParked() {
  this.setSkipTaskbar(true);
  setPosition.call(this, OFF_SCREEN, OFF_SCREEN);
  showInactive.call(this);
}

BrowserWindow.prototype.show = showParked;
BrowserWindow.prototype.showInactive = showParked;
// Sizes still apply, positions do not: nothing may bring a window back onto the screen.
BrowserWindow.prototype.setBounds = function (bounds, animate) {
  setBounds.call(this, { ...bounds, x: OFF_SCREEN, y: OFF_SCREEN }, animate);
};
for (const method of ['setPosition', 'center', 'focus', 'moveTop', 'maximize', 'setFullScreen']) {
  BrowserWindow.prototype[method] = () => {};
}
app.focus = () => {};
// An off-screen window counts as occluded on Windows, and would stop painting.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
