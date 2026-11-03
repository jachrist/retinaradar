import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpSettings } from "../config/settings.js";
import type { Digest } from "./digest.js";
import { renderDigest, type RenderOptions } from "./render.js";

export interface Notifier {
  send(digest: Digest): Promise<void>;
  /** Brukes ved dry run: vis varselet uten å sende det. */
  preview?(digest: Digest): Promise<void>;
}

/** Sender e-post via SMTP (f.eks. Gmail med app-passord: smtp.gmail.com:465). */
export class SmtpNotifier implements Notifier {
  private readonly transport: Transporter;

  constructor(
    private readonly smtp: SmtpSettings,
    private readonly render: RenderOptions = {},
  ) {
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.password },
    });
  }

  async send(digest: Digest): Promise<void> {
    const r = renderDigest(digest, this.render);
    await this.transport.sendMail({
      from: this.smtp.from,
      to: this.smtp.to,
      subject: r.subject,
      text: r.text,
      html: r.html,
    });
  }
}

/** Skriver varselet til out/-mappen (tekst + HTML). Brukes lokalt og ved dry run. */
export class FileNotifier implements Notifier {
  constructor(
    private readonly outDir: string,
    private readonly render: RenderOptions = {},
    private readonly log: (msg: string) => void = console.log,
  ) {}

  async send(digest: Digest): Promise<void> {
    const r = renderDigest(digest, this.render);
    await mkdir(this.outDir, { recursive: true });
    const stamp = digest.generatedAt.replace(/[:.]/g, "-");
    const base = path.join(this.outDir, `digest-${stamp}`);
    await writeFile(`${base}.txt`, r.text, "utf8");
    await writeFile(`${base}.html`, r.html, "utf8");
    this.log(`Varsel skrevet til ${base}.txt og .html`);
  }

  preview(digest: Digest): Promise<void> {
    return this.send(digest);
  }
}
