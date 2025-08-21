import { Resend } from "resend";
import { config } from "../config/auth";

const resend = new Resend(config.resendApiKey);

const BRAND_PRIMARY = "#1e3a8a"; // biru gelap
const BRAND_ACCENT = "#2563eb";  // biru
const TEXT_COLOR = "#0f172a";    // slate-900
const MUTED_COLOR = "#475569";   // slate-600
const BORDER_COLOR = "#e2e8f0";  // slate-200
const BG_COLOR = "#f8fafc";      // slate-50

function baseEmailHTML({
  preheader,
  title,
  contentHTML,
  ctaLabel,
  ctaHref,
  footerNote,
}: {
  preheader: string;
  title: string;
  contentHTML: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote?: string;
}) {
  return `
  <!doctype html>
  <html lang="id">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
    <style>
      @media (max-width: 640px) {
        .container { width: 100% !important; }
        .px { padding-left:16px !important; padding-right:16px !important; }
      }
    </style>
  </head>
  <body style="margin:0; background:${BG_COLOR}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif;">
    <!-- Preheader (hidden) -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; visibility:hidden;">${preheader}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG_COLOR};">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px; max-width:100%;">
            <!-- Header -->
            <tr>
              <td class="px" style="padding:24px 32px; text-align:left;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="font-weight:700; font-size:18px; color:${BRAND_PRIMARY};">
                      Budgetify
                    </td>
                    <td align="right" style="font-size:12px; color:${MUTED_COLOR};">
                      Notifikasi Sistem
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td class="px" style="padding:0 32px 32px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff; border:1px solid ${BORDER_COLOR}; border-radius:12px; overflow:hidden;">
                  <tr>
                    <td style="padding:28px 28px 8px 28px; border-bottom:1px solid ${BORDER_COLOR};">
                      <h1 style="margin:0; font-size:20px; line-height:1.4; color:${TEXT_COLOR};">${title}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:20px 28px; color:${TEXT_COLOR}; font-size:14px; line-height:1.7;">
                      ${contentHTML}
                      ${ctaLabel && ctaHref ? `
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;">
                          <tr>
                            <td align="left" style="border-radius:8px; background:${BRAND_ACCENT};">
                              <a href="${ctaHref}" style="display:inline-block; padding:12px 18px; font-weight:600; text-decoration:none; color:#fff;">${ctaLabel}</a>
                            </td>
                          </tr>
                        </table>
                      ` : ``}
                      ${footerNote ? `
                        <p style="margin-top:20px; font-size:12px; color:${MUTED_COLOR};">${footerNote}</p>
                      ` : ``}
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" style="margin-top:16px;">
                  <tr>
                    <td style="font-size:12px; color:${MUTED_COLOR}; text-align:left;">
                      Email ini dikirim otomatis oleh Budgetify. Jangan balas ke alamat ini.
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:12px; color:${MUTED_COLOR}; padding-top:8px;">
                      © ${new Date().getFullYear()} Budgetify
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

export const sendRegistrationEmail = async (email: string, name: string) => {
  const subject = `Selamat datang di Budgetify, ${name}! 🎉`;
  const preheader = "Akun kamu berhasil dibuat. Yuk mulai atur anggaran pertama kamu.";
  const html = baseEmailHTML({
    preheader,
    title: "Akun Berhasil Dibuat",
    contentHTML: `
      <p>Hai <strong>${email}</strong>,</p>
      <p>Selamat bergabung! Akun kamu sudah aktif dan siap dipakai untuk mengelola anggaran dengan lebih rapi, cepat, dan terukur.</p>
      <ul style="padding-left:18px; margin:12px 0;">
        <li>Lihat ringkasan anggaran dalam satu dashboard</li>
        <li>Buat RAB/estimasi proyek dengan presisi</li>
        <li>Export laporan ke PDF/Excel untuk dibagikan</li>
      </ul>
      <p>Mulai sekarang, kamu bisa masuk ke aplikasi dan membuat anggaran pertamamu.</p>
    `,
    ctaLabel: "Masuk ke Budgetify",
    ctaHref: "https://app.budgetify.id/login",
    footerNote: "Jika kamu tidak merasa membuat akun, abaikan email ini."
  });

  const text = [
    `Akun Berhasil Dibuat`,
    ``,
    `Hai ${email},`,
    `Akun kamu sudah aktif. Kamu bisa masuk ke aplikasi dan mulai membuat anggaran pertama.`,
    `Masuk: https://app.budgetify.id/login`,
    ``,
    `Jika kamu tidak merasa membuat akun, abaikan email ini.`,
  ].join("\n");

  const { data, error } = await resend.emails.send({
    from: "Budgetify <no-reply@budgetify.id>",
    to: email,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Error sending registration email:", error);
    throw error;
  }
  return data;
};

export const sendOtpEmail = async (email: string, otp: string, name: string) => {
  const subject = "Kode OTP Budgetify Kamu (berlaku 15 menit)";
  const preheader = "Jangan bagikan OTP ke siapa pun. Berlaku 15 menit.";
  const html = baseEmailHTML({
    preheader,
    title: "Verifikasi Masuk",
    contentHTML: `
      <p>Hai, <strong>${name}</strong></p>
      <p>Gunakan kode berikut untuk menyelesaikan proses masuk:</p>
      <div style="margin:16px 0; padding:14px 16px; border:1px dashed ${BORDER_COLOR}; border-radius:10px; text-align:center;">
        <div style="font-size:28px; letter-spacing:6px; font-weight:700; color:${BRAND_PRIMARY};">${otp}</div>
        <div style="font-size:12px; color:${MUTED_COLOR}; margin-top:6px;">Berlaku selama 15 menit</div>
      </div>
      <p style="margin-top:0;">Demi keamanan, <strong>jangan bagikan OTP</strong> ini kepada siapa pun, termasuk pihak yang mengaku dari Budgetify.</p>
    `,
    footerNote: "Tidak meminta OTP? Abaikan email ini."
  });

  const text = [
    `Verifikasi Masuk`,
    ``,
    `Kode OTP: ${otp}`,
    `Berlaku 15 menit. Jangan bagikan kode ini ke siapa pun.`,
    ``,
    `Jika kamu tidak meminta OTP, abaikan email ini.`,
  ].join("\n");

  const { data, error } = await resend.emails.send({
    from: "Budgetify <no-reply@budgetify.id>",
    to: email,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Error sending OTP email:", error);
    throw error;
  }
  return data;
};
