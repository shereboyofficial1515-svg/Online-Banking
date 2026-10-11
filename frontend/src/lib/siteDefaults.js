// Built-in website content shipped with the app. It is what visitors see if the content API is unreachable or nothing has been
// published yet. Kept identical to backend/src/content/siteDefaults.js (a test enforces that).
export const ICONS = ["wallet","swap","upload","id","bell","lifebuoy","fingerprint","shield-check","device","clipboard","lock","zap","bank","card","chart","users","globe","mail","phone","check-circle","shield","key","clock","file"];
export const DEFAULT_SITE_CONFIG = {
  "brand": {
    "siteName": "EWB Bank",
    "logoText": "EWB Bank",
    "shortDescription": "Secure, modern digital banking built around clarity and control.",
    "logoLightAssetId": null,
    "logoDarkAssetId": null,
    "faviconAssetId": null,
    "colors": {
      "primary": "#0B1F3A",
      "secondary": "#1C3A63",
      "accent": "#C8102E"
    }
  },
  "contact": {
    "email": "",
    "phone": "",
    "address": "",
    "hours": "Monday to Friday, 9:00–17:00"
  },
  "footer": {
    "text": "Secure, modern digital banking built around clarity and control."
  },
  "social": [],
  "home": {
    "eyebrow": "Security-first digital banking",
    "headline": "Banking that keeps you in control.",
    "description": "EWB Bank brings your accounts, transfers and support into one calm, secure place — with passkeys, multi-factor authentication and a permanent record of every transaction.",
    "heroImageAssetId": null,
    "heroImageAlt": "Modern glass office buildings seen from below",
    "primaryButton": {
      "label": "Open an account",
      "to": "/register"
    },
    "secondaryButton": {
      "label": "Sign in",
      "to": "/login"
    },
    "protections": [
      {
        "label": "Passkey or password sign-in",
        "value": "Strong"
      },
      {
        "label": "Authenticator-app MFA",
        "value": "Available"
      },
      {
        "label": "New-device alerts",
        "value": "Always on"
      },
      {
        "label": "Append-only audit trail",
        "value": "Always on"
      }
    ],
    "about": {
      "title": "A modern bank experience, built carefully",
      "text": "EWB Bank is designed for people who want clarity: clear balances, clear history, and clear explanations when something needs review. Every figure you see reflects your recorded transactions, and every sensitive action is logged.",
      "points": [
        "Balances that always match your transaction history",
        "Plain-language status for every request",
        "Every credit, debit and transfer recorded and traceable",
        "Clear terms and transparent service information"
      ]
    },
    "services": {
      "title": "Banking services",
      "intro": "Everything you need to manage your accounts day to day.",
      "items": [
        {
          "icon": "wallet",
          "title": "Everyday accounts",
          "text": "Open a checking account and track balances, activity and statements-ready transaction history in one place."
        },
        {
          "icon": "swap",
          "title": "Account-to-account transfers",
          "text": "Move value between EWB accounts instantly, with a unique reference and a notification for both parties."
        },
        {
          "icon": "upload",
          "title": "Withdrawal requests",
          "text": "Submit a withdrawal request and follow its review status. Our Customer Support team reviews every request."
        },
        {
          "icon": "id",
          "title": "Identity verification",
          "text": "Complete verification once and unlock transfers. Documents are stored privately and reviewed by compliance staff."
        },
        {
          "icon": "bell",
          "title": "Alerts and notifications",
          "text": "Choose which updates you receive. Security notices are always on so you can spot unexpected activity quickly."
        },
        {
          "icon": "lifebuoy",
          "title": "Customer support",
          "text": "Open a request, attach documents and follow the conversation with a dedicated support team."
        }
      ]
    },
    "security": {
      "title": "Security you can see and control",
      "intro": "Protection is not an afterthought. Every layer, from sign-in to the database, is designed to limit what can go wrong and to make anything unusual visible.",
      "points": [
        "Passkeys (WebAuthn) and TOTP multi-factor authentication",
        "Short-lived sessions, rotating tokens and device management",
        "Account lock-outs after repeated failed attempts",
        "Strict access control: you can only ever see your own records",
        "Security alerts by email for new devices and password changes"
      ]
    },
    "digital": {
      "title": "Digital banking, designed for every screen",
      "intro": "A touch-friendly experience on your phone with a bottom navigation bar, and a full-featured dashboard on larger screens.",
      "items": [
        {
          "icon": "fingerprint",
          "title": "Passkey sign-in",
          "text": "Use your fingerprint, face or device PIN. Your biometric never leaves your device."
        },
        {
          "icon": "shield-check",
          "title": "Multi-factor authentication",
          "text": "Add an authenticator app and single-use recovery codes to protect your profile."
        },
        {
          "icon": "device",
          "title": "Session and device control",
          "text": "See where you are signed in and end any session in one tap."
        },
        {
          "icon": "clipboard",
          "title": "Permanent transaction records",
          "text": "Every transaction is recorded permanently. Corrections are made with new, clearly referenced entries."
        },
        {
          "icon": "lock",
          "title": "Privacy by design",
          "text": "We collect only what is needed and keep verification files in private storage."
        },
        {
          "icon": "zap",
          "title": "Fast on every screen",
          "text": "A responsive experience for phones, tablets and desktops with accessible controls."
        }
      ]
    },
    "faq": {
      "title": "Frequently asked questions",
      "items": [
        {
          "q": "Is EWB Bank a licensed bank? Are balances insured?",
          "a": "EWB Bank is a financial technology platform and does not currently hold a banking licence, so balances are maintained by EWB Bank rather than held as insured deposits. Banking services will be provided through a licensed banking partner when they become available, and we will announce it here once that is in place."
        },
        {
          "q": "How is my balance calculated?",
          "a": "Your balance is the total of the completed transactions on your account. Every transaction is permanent and traceable, and a balance is never edited directly — corrections are made with new, clearly referenced transactions."
        },
        {
          "q": "How do withdrawals work?",
          "a": "Submit a withdrawal request from your dashboard and our Customer Support team will review it. The status you see always reflects what has actually happened — we never show a transfer as sent unless it was."
        },
        {
          "q": "How does passkey sign-in work?",
          "a": "Your device creates a cryptographic key pair. We store only the public key. Fingerprint or face checks happen on your device, and we never receive biometric data."
        },
        {
          "q": "How do you verify my identity?",
          "a": "You upload an ID document and selfie, or complete a check with a verification provider once one is connected. We keep only the minimum information required and notify you of the outcome by email."
        },
        {
          "q": "What should I do if I notice unusual activity?",
          "a": "Change your password, end other sessions from the Security page, and contact customer support. We will never ask for your password or one-time codes."
        }
      ]
    },
    "contactSection": {
      "title": "Contact us",
      "text": "Customers can open and track requests from their dashboard. For general questions, reach our team by email and we will reply as soon as we can."
    }
  },
  "about": {
    "title": "About EWB Bank",
    "intro": "EWB Bank is a digital banking platform focused on security, transparency and a calm, clear experience.",
    "body": "## What we do\nWe give customers one secure place to manage accounts, move funds between EWB accounts, request withdrawals and get help from a real support team.\n\n## How we work\n- Security first: passkeys, multi-factor authentication and session control are built in.\n- Transparency: every transaction is recorded permanently and can be traced.\n- Clarity: plain-language statuses and straightforward terms.\n\n## Where we are today\nEWB Bank is a financial technology platform. Banking services will be provided through a licensed banking partner when they become available, and we will announce it on this site once that is in place."
  }
};
export const LEGAL_ROUTES = {
  "terms": {
    "title": "Terms of Service",
    "route": "/terms"
  },
  "privacy": {
    "title": "Privacy Policy",
    "route": "/privacy"
  },
  "cookies": {
    "title": "Cookie Policy",
    "route": "/cookies"
  },
  "security": {
    "title": "Security Policy",
    "route": "/security-info"
  },
  "accessibility": {
    "title": "Accessibility Statement",
    "route": "/accessibility"
  }
};
