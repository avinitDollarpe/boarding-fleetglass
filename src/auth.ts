import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { db, pool } from "@/db/client";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER || "smtp://127.0.0.1:1025",
      from: process.env.EMAIL_FROM || "Fleetglass <noreply@localhost>",
      async sendVerificationRequest({ identifier, url }) {
        if (process.env.DEV_MAILBOX === "1" || !process.env.EMAIL_SERVER) {
          await pool.query("INSERT INTO dev_mailbox (identifier, url) VALUES ($1, $2)", [identifier, url]);
          console.log(`[fleetglass] magic link for ${identifier}: ${url}`);
        }
        if (!process.env.EMAIL_SERVER) return;
        const nodemailer = await import("nodemailer");
        const transport = nodemailer.createTransport(process.env.EMAIL_SERVER);
        await transport.sendMail({
          to: identifier,
          from: process.env.EMAIL_FROM || "Fleetglass <noreply@localhost>",
          subject: "Your Fleetglass sign-in link",
          text: `Sign in to Fleetglass:\n${url}\n\nThis link expires in 24 hours.`,
        });
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
