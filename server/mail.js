// E-Mail-Versand über das Mailsystem der Klinik (INT-03, PRO-07).
// Konfiguration ausschließlich über Umgebungsvariablen:
//   GGP_SMTP_HOST, GGP_SMTP_PORT (Standard 25), GGP_SMTP_SECURE (1 = TLS ab Verbindung),
//   GGP_SMTP_USER / GGP_SMTP_PASS (optional), GGP_MAIL_FROM (Absenderadresse)
const nodemailer = require('nodemailer');
const { get } = require('./db');
const { ApiError } = require('./util');

function konfiguriert() {
  return Boolean(process.env.GGP_SMTP_HOST);
}

function transport() {
  if (!konfiguriert()) {
    throw new ApiError(503, 'E-Mail-Versand ist nicht konfiguriert (GGP_SMTP_HOST setzen) – bitte das Protokoll-PDF herunterladen und manuell versenden');
  }
  return nodemailer.createTransport({
    host: process.env.GGP_SMTP_HOST,
    port: Number(process.env.GGP_SMTP_PORT || 25),
    secure: process.env.GGP_SMTP_SECURE === '1',
    ...(process.env.GGP_SMTP_USER
      ? { auth: { user: process.env.GGP_SMTP_USER, pass: process.env.GGP_SMTP_PASS || '' } }
      : {}),
    tls: { rejectUnauthorized: process.env.GGP_SMTP_TLS_UNSICHER === '1' ? false : true },
  });
}

function absender() {
  const eingestellt = get("SELECT value FROM settings WHERE key = 'absender_email'");
  return process.env.GGP_MAIL_FROM || (eingestellt && eingestellt.value) || 'ggp@klinik.local';
}

/**
 * @param {object} mail {an: string[], betreff, text, anhaenge: [{filename, content}]}
 * @returns {Promise<{versandt: string[]}>}
 */
async function sendeMail({ an, betreff, text, anhaenge = [] }) {
  const empfaenger = [...new Set((an || []).filter((a) => a && a.includes('@')))];
  if (!empfaenger.length) throw new ApiError(400, 'Keine Empfänger mit E-Mail-Adresse vorhanden');
  await transport().sendMail({
    from: absender(),
    to: empfaenger.join(', '),
    subject: betreff,
    text,
    attachments: anhaenge,
  });
  return { versandt: empfaenger };
}

module.exports = { sendeMail, konfiguriert };
