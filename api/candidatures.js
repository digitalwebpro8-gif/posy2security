import { head, get, del } from "@vercel/blob";
import { getDb, getCookie, hashSessionToken, SESSION_COOKIE } from "../lib/auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 32 * 1024) {
      throw new Error("Données de candidature trop volumineuses.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const MAX_CV_SIZE = 10 * 1024 * 1024;
const CV_PATH_PATTERN = /^candidatures\/[0-9a-f-]{36}\.pdf$/i;

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function hasPdfSignature(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return false;

  const reader = result.stream.getReader();
  let prefix = Buffer.alloc(0);

  try {
    while (prefix.length < 5) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix = Buffer.concat([prefix, Buffer.from(value)]);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function verifyAdmin(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const sql = getDb();
  const tokenHash = hashSessionToken(token);
  const admins = await sql`
    SELECT a.id
    FROM sessions_admin s
    INNER JOIN administrateurs a ON a.id = s.administrateur_id
    WHERE s.jeton_hash = ${tokenHash}
      AND s.expiration > NOW()
      AND a.statut = 'actif'
    LIMIT 1
  `;
  return admins[0] || null;
}

function pickColumn(columns, choices) {
  return choices.find(name => columns.has(name)) || null;
}

async function handleContactSubmission(req, res) {
  const body = await readJsonBody(req);
  if (clean(body.website, 200)) {
    return res.status(200).json({ success:true, message:"Votre message a bien été reçu." });
  }

  const nom = clean(body.nom, 160);
  const telephone = clean(body.telephone, 40);
  const email = clean(body.email, 254).toLowerCase();
  const sujet = clean(body.sujet, 160) || "Demande via le site";
  const message = clean(body.message, 4000);

  if (!nom || !telephone || message.length < 8) {
    return res.status(400).json({
      success:false,
      message:"Veuillez renseigner votre nom, votre téléphone et un message d'au moins 8 caractères."
    });
  }
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    return res.status(400).json({ success:false, message:"L'adresse e-mail est invalide." });
  }

  const sql = getDb();
  const schema = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts'
  `;
  const columns = new Set(schema.map(row => row.column_name));
  if (!columns.size) throw new Error("La table contacts est introuvable.");

  const mapping = [
    [pickColumn(columns, ["nom", "name", "full_name"]), nom],
    [pickColumn(columns, ["telephone", "phone"]), telephone],
    [pickColumn(columns, ["email"]), email || null],
    [pickColumn(columns, ["sujet", "objet", "subject"]), sujet],
    [pickColumn(columns, ["message", "contenu"]), message],
    [pickColumn(columns, ["statut", "status"]), "nouveau"]
  ].filter(([column]) => column);

  const dateColumn = pickColumn(columns, ["date_creation", "created_at"]);
  const insertColumns = mapping.map(([column]) => column);
  const values = mapping.map(([, value]) => value);
  const placeholders = values.map((_, index) => `${index + 1}`);
  if (dateColumn) {
    insertColumns.push(dateColumn);
    placeholders.push("NOW()");
  }

  if (!insertColumns.some(name => ["nom", "name", "full_name"].includes(name)) ||
      !insertColumns.some(name => ["message", "contenu"].includes(name))) {
    throw new Error("La structure de la table contacts ne contient pas les champs requis.");
  }

  const inserted = await sql.query(
    `INSERT INTO contacts (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    values
  );
  return res.status(201).json({
    success:true,
    message:"Votre message a bien été envoyé. Notre équipe vous recontactera.",
    id:inserted[0]?.id ?? null
  });
}

async function handleAdminContacts(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return res.status(401).json({ success:false, message:"Connexion administrateur requise." });
  }

  const sql = getDb();
  const schema = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts'
  `;
  const columns = new Set(schema.map(row => row.column_name));
  if (!columns.size) throw new Error("La table contacts est introuvable.");

  const fields = [
    ["id", pickColumn(columns, ["id"])],
    ["nom", pickColumn(columns, ["nom", "name", "full_name"])],
    ["telephone", pickColumn(columns, ["telephone", "phone"])],
    ["email", pickColumn(columns, ["email"])],
    ["sujet", pickColumn(columns, ["sujet", "objet", "subject"])],
    ["message", pickColumn(columns, ["message", "contenu"])],
    ["statut", pickColumn(columns, ["statut", "status"])],
    ["date_creation", pickColumn(columns, ["date_creation", "created_at"])]
  ];
  const selected = fields.filter(([, column]) => column)
    .map(([alias, column]) => column === alias ? column : `${column} AS ${alias}`);
  const orderColumn = pickColumn(columns, ["date_creation", "created_at", "id"]);
  const order = orderColumn ? ` ORDER BY ${orderColumn} DESC` : "";
  const contacts = await sql.query(
    `SELECT ${selected.join(", ")} FROM contacts${order} LIMIT 200`,
    []
  );
  return res.status(200).json({ success:true, contacts });
}

export default async function handler(req, res) {
  const mode = String(req.query?.type || "");

  try {
    if (req.method === "POST" && mode === "contact") {
      return await handleContactSubmission(req, res);
    }
    if (req.method === "GET" && mode === "contacts") {
      return await handleAdminContacts(req, res);
    }
  } catch (error) {
    console.error("Erreur gestion contacts:", error);
    return res.status(500).json({
      success:false,
      message:"Impossible de traiter cette demande pour le moment."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée.",
    });
  }

  let uploadedPath = null;

  try {
    const body = await readJsonBody(req);
    const nom = clean(body.nom, 160);
    const email = clean(body.email, 254).toLowerCase();
    const telephone = clean(body.telephone, 40);
    const poste = clean(body.poste, 160);
    const message = clean(body.message, 3000);
    const cvPath = clean(body.cvPath, 220);

    if (!nom || !telephone || !poste) {
      return res.status(400).json({
        success: false,
        message: "Le nom, le téléphone et le poste souhaité sont obligatoires.",
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "L'adresse e-mail est invalide.",
      });
    }

    if (!CV_PATH_PATTERN.test(cvPath)) {
      return res.status(400).json({
        success: false,
        message: "Veuillez joindre votre CV au format PDF.",
      });
    }

    uploadedPath = cvPath;
    const metadata = await head(cvPath);

    if (metadata.size > MAX_CV_SIZE) {
      await del(cvPath);
      uploadedPath = null;
      return res.status(400).json({
        success: false,
        message: "Le CV ne doit pas dépasser 10 Mo.",
      });
    }

    if (metadata.contentType !== "application/pdf" || !(await hasPdfSignature(cvPath))) {
      await del(cvPath);
      uploadedPath = null;
      return res.status(400).json({
        success: false,
        message: "Le fichier fourni n'est pas un véritable document PDF.",
      });
    }

    const sql = getDb();
    const inserted = await sql`
      INSERT INTO candidatures
        (nom, email, telephone, poste, message, cv_url, statut, date_creation)
      VALUES
        (${nom}, ${email || null}, ${telephone}, ${poste}, ${message || null},
         ${cvPath}, 'nouveau', NOW())
      RETURNING id
    `;

    uploadedPath = null;

    return res.status(201).json({
      success: true,
      message: "Votre candidature a bien été envoyée. Nous vous remercions de votre intérêt.",
      id: inserted[0].id,
    });
  } catch (error) {
    if (uploadedPath) {
      try {
        await del(uploadedPath);
      } catch (cleanupError) {
        console.error("Nettoyage du CV impossible:", cleanupError);
      }
    }

    console.error("Erreur dépôt candidature:", error);
    return res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
    });
  }
}
