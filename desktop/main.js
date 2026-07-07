// GGP als Desktop-Anwendung (macOS/Windows/Linux): startet den eingebetteten
// Server auf einem freien lokalen Port und öffnet die Oberfläche im App-Fenster.
const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Daten liegen im Benutzerprofil (macOS: ~/Library/Application Support/GGP/daten)
const datenVerzeichnis = path.join(app.getPath('userData'), 'daten');
process.env.GGP_DATA_DIR = process.env.GGP_DATA_DIR || datenVerzeichnis;

let fenster = null;

async function starteServer() {
  // Erst NACH dem Setzen von GGP_DATA_DIR laden (db.js liest die Variable beim Import)
  const serverApp = require(path.join(__dirname, '..', 'server', 'index.js'));
  return new Promise((resolve, reject) => {
    const httpServer = serverApp.listen(0, '127.0.0.1', () => resolve(httpServer));
    httpServer.on('error', reject);
  });
}

function zeigeErstpasswort() {
  const datei = path.join(process.env.GGP_DATA_DIR, 'ADMIN-PASSWORT.txt');
  try {
    if (fs.existsSync(datei)) {
      const inhalt = fs.readFileSync(datei, 'utf8');
      const passwort = (inhalt.match(/:\s*(\S+)/) || [])[1];
      if (passwort) {
        dialog.showMessageBox({
          type: 'info',
          title: 'GGP – Erste Anmeldung',
          message: 'Willkommen bei GGP!',
          detail: `Benutzername: admin\nErstpasswort: ${passwort}\n\nBitte nach der Anmeldung in der Administration ändern.\n(Hinterlegt in: ${datei})`,
          buttons: ['Verstanden'],
        });
      }
    }
  } catch { /* Hinweis ist Komfort */ }
}

async function erstelleFenster() {
  const httpServer = await starteServer();
  const { port } = httpServer.address();

  fenster = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'GGP – Großgeräte-Projektabwicklung',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  fenster.setMenuBarVisibility(false);

  // PDFs/Exporte im selben Ursprung als eigenes Fenster (Chromium-PDF-Viewer),
  // externe Links im Standardbrowser
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}/`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await fenster.loadURL(`http://127.0.0.1:${port}/`);
  zeigeErstpasswort();
}

app.whenReady().then(erstelleFenster).catch((e) => {
  dialog.showErrorBox('GGP konnte nicht starten', String(e && e.stack ? e.stack : e));
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && fenster === null) erstelleFenster();
});

app.on('window-all-closed', () => {
  // Auf macOS bleibt die App üblicherweise im Dock aktiv; der lokale Server läuft weiter
  if (process.platform !== 'darwin') app.quit();
});
