const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

// Simple check: if we're in production, app.isPackaged will be true
const isDev = !app.isPackaged;

function createWindow() {
  console.log('Creating window...');
  
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const startURL = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, 'index.html')}`;

  console.log('Loading URL:', startURL);

  mainWindow.loadURL(startURL);

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Only show dev tools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

app.on('ready', () => {
  console.log('App ready');
  createWindow();
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log('App activated');
  if (mainWindow === null) {
    createWindow();
  }
});