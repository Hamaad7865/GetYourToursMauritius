import { SITE } from '@/lib/seo/site';

/**
 * Bilingual (EN/FR) auth-email rendering for the Supabase Send-Email hook.
 *
 * These are the code twins of supabase/auth-email-templates/*.html (the dashboard-paste fallback,
 * EN-only): same layout — logo header, white card on a pale wash, teal-dark pill button, legal
 * footer — but the copy is chosen per user. Dashboard templates are single-language; per-user
 * language is the entire reason the hook exists.
 *
 * Email-client constraints shape everything here: table layout, inline styles only, and the logo
 * must be the live PNG (clients don't render SVG). Brand hexes are hard-coded because emails can't
 * read the site's CSS variables — if the palette changes, update BRAND below AND the fallback
 * HTML files.
 */

export type AuthEmailLang = 'en' | 'fr';

export type AuthEmailKind =
  | 'recovery'
  | 'signup'
  | 'magiclink'
  | 'email_change'
  | 'reauthentication';

const BRAND = {
  wash: '#f0f4f5',
  card: '#ffffff',
  ink: '#0a2e36',
  muted: '#51666b',
  tealDark: '#0b5c63',
} as const;

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface Copy {
  subject: string;
  preheader: string;
  heading: string;
  /** Paragraphs above the button. `%email%` / `%newEmail%` are substituted, pre-escaped. */
  body: string[];
  button: string;
  /** Small muted lines under the button. */
  fine: string[];
}

/** `%email%`-style placeholders keep the translated strings literal (no template-literal soup). */
const COPY: Record<AuthEmailKind, Record<AuthEmailLang, Copy>> = {
  recovery: {
    en: {
      subject: 'Reset your Belle Mare Tours password',
      preheader:
        'Choose a new password for your Belle Mare Tours account. The link expires in about 60 minutes.',
      heading: 'Reset your password',
      body: [
        'Hi,',
        'Someone asked to reset the password for your Belle Mare Tours account (%email%). Click below to choose a new one.',
      ],
      button: 'Set a new password',
      fine: [
        'The link works once and expires in about 60 minutes.',
        'If this wasn&rsquo;t you, ignore this email &mdash; your password stays as it is.',
      ],
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe Belle Mare Tours',
      preheader:
        'Choisissez un nouveau mot de passe pour votre compte Belle Mare Tours. Le lien expire dans environ 60 minutes.',
      heading: 'Réinitialisez votre mot de passe',
      body: [
        'Bonjour,',
        'Quelqu&rsquo;un a demandé à réinitialiser le mot de passe de votre compte Belle Mare Tours (%email%). Cliquez ci-dessous pour en choisir un nouveau.',
      ],
      button: 'Choisir un nouveau mot de passe',
      fine: [
        'Le lien ne fonctionne qu&rsquo;une fois et expire dans environ 60 minutes.',
        'Si ce n&rsquo;était pas vous, ignorez cet e-mail &mdash; votre mot de passe reste inchangé.',
      ],
    },
  },
  signup: {
    en: {
      subject: 'Confirm your email for Belle Mare Tours',
      preheader: 'One click and your Belle Mare Tours account is ready.',
      heading: 'Welcome to Belle Mare Tours',
      body: [
        'Hi,',
        'Thanks for creating an account. Confirm your email address (%email%) and you&rsquo;re ready to book catamaran cruises, island days and airport transfers &mdash; direct with the operator.',
      ],
      button: 'Confirm my email',
      fine: ['Didn&rsquo;t create this account? Ignore this email and nothing happens.'],
    },
    fr: {
      subject: 'Confirmez votre e-mail pour Belle Mare Tours',
      preheader: 'Un clic et votre compte Belle Mare Tours est prêt.',
      heading: 'Bienvenue chez Belle Mare Tours',
      body: [
        'Bonjour,',
        'Merci d&rsquo;avoir créé un compte. Confirmez votre adresse e-mail (%email%) et vous pourrez réserver croisières en catamaran, sorties aux îles et transferts aéroport &mdash; en direct avec l&rsquo;opérateur.',
      ],
      button: 'Confirmer mon e-mail',
      fine: ['Vous n&rsquo;avez pas créé ce compte&nbsp;? Ignorez cet e-mail.'],
    },
  },
  magiclink: {
    en: {
      subject: 'Your Belle Mare Tours sign-in link',
      preheader: 'Your one-time sign-in link for Belle Mare Tours. Expires in about 60 minutes.',
      heading: 'Sign in to Belle Mare Tours',
      body: ['Click below to sign in as %email%. No password needed.'],
      button: 'Sign me in',
      fine: [
        'The link works once and expires in about 60 minutes.',
        'If you didn&rsquo;t request it, ignore this email &mdash; nobody can sign in without it.',
      ],
    },
    fr: {
      subject: 'Votre lien de connexion Belle Mare Tours',
      preheader:
        'Votre lien de connexion unique pour Belle Mare Tours. Expire dans environ 60 minutes.',
      heading: 'Connectez-vous à Belle Mare Tours',
      body: [
        'Cliquez ci-dessous pour vous connecter en tant que %email%. Aucun mot de passe requis.',
      ],
      button: 'Me connecter',
      fine: [
        'Le lien ne fonctionne qu&rsquo;une fois et expire dans environ 60 minutes.',
        'Si vous n&rsquo;êtes pas à l&rsquo;origine de cette demande, ignorez cet e-mail.',
      ],
    },
  },
  email_change: {
    en: {
      subject: 'Confirm your new email address',
      preheader: 'Confirm the change of your Belle Mare Tours account email.',
      heading: 'Confirm your new email',
      body: [
        'You asked to change your Belle Mare Tours account email from %email% to %newEmail%. Confirm to make the switch.',
      ],
      button: 'Confirm the change',
      fine: ['Didn&rsquo;t ask for this? Ignore this email and your address stays as it is.'],
    },
    fr: {
      subject: 'Confirmez votre nouvelle adresse e-mail',
      preheader: 'Confirmez le changement d&rsquo;adresse de votre compte Belle Mare Tours.',
      heading: 'Confirmez votre nouvelle adresse',
      body: [
        'Vous avez demandé à changer l&rsquo;adresse e-mail de votre compte Belle Mare Tours de %email% à %newEmail%. Confirmez pour valider le changement.',
      ],
      button: 'Confirmer le changement',
      fine: [
        'Vous n&rsquo;avez rien demandé&nbsp;? Ignorez cet e-mail, votre adresse reste inchangée.',
      ],
    },
  },
  reauthentication: {
    en: {
      subject: 'Your Belle Mare Tours verification code',
      preheader: 'Your one-time verification code.',
      heading: 'Your verification code',
      body: ['Enter this code to confirm it&rsquo;s you:'],
      button: '', // no link — the code renders in place of the button
      fine: ['The code expires shortly. If this wasn&rsquo;t you, ignore this email.'],
    },
    fr: {
      subject: 'Votre code de vérification Belle Mare Tours',
      preheader: 'Votre code de vérification à usage unique.',
      heading: 'Votre code de vérification',
      body: ['Saisissez ce code pour confirmer que c&rsquo;est bien vous&nbsp;:'],
      button: '',
      fine: ['Le code expire rapidement. Si ce n&rsquo;était pas vous, ignorez cet e-mail.'],
    },
  },
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fill(line: string, vars: { email?: string; newEmail?: string }): string {
  return line
    .replace('%email%', `<span style="color:${BRAND.tealDark};">${esc(vars.email ?? '')}</span>`)
    .replace(
      '%newEmail%',
      `<span style="color:${BRAND.tealDark};">${esc(vars.newEmail ?? '')}</span>`,
    );
}

export interface RenderAuthEmailInput {
  kind: AuthEmailKind;
  lang: AuthEmailLang;
  email: string;
  /** The verify link (absent only for reauthentication, which shows `code` instead). */
  actionUrl?: string;
  newEmail?: string;
  /** 6-digit OTP for reauthentication. */
  code?: string;
}

export function renderAuthEmail(input: RenderAuthEmailInput): { subject: string; html: string } {
  const c = COPY[input.kind][input.lang];
  const paragraphs = c.body
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${BRAND.ink};">${fill(
          line,
          input,
        )}</p>`,
    )
    .join('\n                ');

  const action = input.code
    ? `<p style="margin:12px 0 28px;text-align:center;font-family:${FONT};font-size:32px;letter-spacing:8px;font-weight:bold;color:${BRAND.tealDark};">${esc(input.code)}</p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:12px auto 28px;">
                  <tr>
                    <td align="center" bgcolor="${BRAND.tealDark}" style="border-radius:999px;">
                      <a href="${esc(input.actionUrl ?? '')}"
                         style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">${c.button}</a>
                    </td>
                  </tr>
                </table>`;

  const fine = c.fine
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-size:13px;line-height:21px;color:${BRAND.muted};text-align:center;">${line}</p>`,
    )
    .join('\n                ');

  const footerAddress = `${SITE.name} &middot; ${SITE.street}, ${SITE.locality}, Mauritius`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BRAND.wash};">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${c.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.wash};">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <tr>
              <td align="center" style="padding:0 0 24px;">
                <a href="${SITE.url}" style="text-decoration:none;">
                  <img src="${SITE.url}/logo.png" width="170" alt="${SITE.name}"
                       style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
                </a>
              </td>
            </tr>
            <tr>
              <td style="background:${BRAND.card};border-radius:16px;padding:40px 40px 32px;font-family:${FONT};">
                <h1 style="margin:0 0 20px;font-size:22px;line-height:28px;color:${BRAND.ink};text-align:center;">${c.heading}</h1>
                ${paragraphs}
                ${action}
                ${fine}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 24px 0;font-family:${FONT};text-align:center;">
                <p style="margin:0 0 6px;font-size:12px;line-height:19px;color:${BRAND.muted};">${footerAddress}</p>
                <p style="margin:0;font-size:12px;line-height:19px;">
                  <a href="${SITE.url}" style="color:${BRAND.tealDark};text-decoration:none;">bellemaretours.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: c.subject, html };
}
