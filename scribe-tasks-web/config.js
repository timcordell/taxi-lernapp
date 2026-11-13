/**
 * Scribe Tasks – öffentliche Konfiguration.
 *
 * Client-IDs von OAuth-Apps sind KEINE Geheimnisse: Sie stehen bei jeder
 * Browser-App im Klartext im Code. Ein Client-Secret wird hier nie benötigt
 * und darf hier auch nie eingetragen werden.
 *
 * Solange ein Wert mit "DEINE_" beginnt, zeigt die App für diesen Dienst
 * einen Hinweis statt einer Anmeldung.
 */
export const CONFIG = {
  // Google Cloud → APIs & Dienste → Anmeldedaten → OAuth-Client-ID (Webanwendung)
  googleClientId: 'DEINE_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Microsoft Entra → App-Registrierungen → Anwendungs-ID (Client-ID)
  microsoftClientId: 'DEINE_MICROSOFT_CLIENT_ID',

  // "common" = Organisationskonten UND persönliche Microsoft-Konten
  microsoftAuthority: 'https://login.microsoftonline.com/common',
};

export const isPlaceholder = (value) => !value || /^DEINE_/.test(value);
