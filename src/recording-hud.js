const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

function hudBounds(area) {
  const width = Math.min(220, area.width);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.max(area.y, area.y + area.height - 100), width, height: 44 };
}

class RecordingHud {
  constructor() { this.window = null; this.state = { status: 'recording', level: 0 }; this.monitor = null; }
  async ensure() {
    if (this.ready) return this.ready;
    this.window = new BrowserWindow({ ...hudBounds(screen.getPrimaryDisplay().workArea), show: false, frame: false, transparent: true,
      resizable: false, movable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'hud-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setIgnoreMouseEvents(true);
    this.ready = this.window.loadFile(path.join(__dirname, 'hud.html'));
    return this.ready;
  }
  async show(status = 'recording') {
    clearTimeout(this.timer);
    this.visible = true;
    this.state.status = status;
    await this.ensure();
    if (!this.visible || this.window.isDestroyed()) return;
    this.monitor ||= screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    const display = screen.getAllDisplays().find((item) => item.id === this.monitor) || screen.getPrimaryDisplay();
    this.window.setBounds(hudBounds(display.workArea));
    this.window.showInactive();
    this.window.webContents.send('hud:state', this.state);
  }
  update(state) {
    this.state = { ...this.state, ...state };
    if (this.visible && this.window && !this.window.isDestroyed()) this.window.webContents.send('hud:state', this.state);
  }
  finish(status = 'done') {
    this.update({ status, level: 0 });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), status === 'blocked' || status === 'review' ? 4500 : 1000);
  }
  hide() { clearTimeout(this.timer); this.visible = false; this.monitor = null; this.window?.hide(); }
  close() { clearTimeout(this.timer); this.visible = false; this.window?.destroy(); this.window = null; this.ready = null; }
}

module.exports = { RecordingHud, hudBounds };
