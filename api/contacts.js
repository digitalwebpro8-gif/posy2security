import { getDb } from "../lib/auth.js";

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function pick(columns, choices) {
  return choices.find(name => columns.has(name)) || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success:false, message:"Méthode non autorisée." });
  }

  try {
    const body = readBody(req);

    // Champ piège anti-robot : les visiteurs légitimes le laissent vide.
    if (clean(body.website, 200)) {
      return res.status(200).json({ success:true, message:"Votre message a bien été reçu." });
    }

    const nom = clean(body.nom, 160);
    const telephone = clean(body.telephone, 40);
    const email = clean(body.email, 254).toLowerCase();
    const sujet = clean(body.sujet, 160);
    const message = clean(body.message, 4000);

    if (!nom || !telephone || !message) {
      return res.status(400).json({
        success:false,
        message:"Veuillez renseigner votre nom, votre téléphone et votre message."
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success:false, message:"L'adresse e-mail est invalide." });
    }
    if (message.length < 8) {
      return res.status(400).json({ success:false, message:"Votre message est trop court." });
    }

    const sql = getDb();
    const schema = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contacts'
    `;
    const columns = new Set(schema.map(row => row.column_name));

    if (!columns.size) {
      throw new Error("La table contacts est introuvable dans la base de données.");
    }

    const mapping = [
      [pick(columns, ["nom", "name", "full_name"]), nom],
      [pick(columns, ["telephone", "phone"]), telephone],
      [pick(columns, ["email"]), email || null],
      [pick(columns, ["sujet", "objet", "subject"]), sujet || "Demande via le site"],
      [pick(columns, ["message", "contenu"]), message],
      [pick(columns, ["statut", "status"]), "nouveau"]
    ].filter(([column]) => column);

    const dateColumn = pick(columns, ["date_creation", "created_at"]);
    const insertColumns = mapping.map(([column]) => column);
    const values = mapping.map(([, value]) => value);
    const placeholders = values.map((_, index) => `$${index + 1}`);

    if (dateColumn) {
      insertColumns.push(dateColumn);
      placeholders.push("NOW()");
    }

    if (!insertColumns.includes("nom") && !insertColumns.includes("name") && !insertColumns.includes("full_name")) {
      throw new Error("La table contacts ne possède pas de colonne pour le nom du contact.");
    }
    if (!insertColumns.includes("message") && !insertColumns.includes("contenu")) {
      throw new Error("La table contacts ne possède pas de colonne pour le message.");
    }

    const query = `INSERT INTO contacts (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`;
    const inserted = await sql.query(query, values);

    return res.status(201).json({
      success:true,
      message:"Votre message a bien été envoyé. Notre équipe vous recontactera.",
      id:inserted[0]?.id ?? null
    });
  } catch (error) {
    console.error("Erreur enregistrement contact:", error);
    return res.status(500).json({
      success:false,
      message:"Nous n'avons pas pu enregistrer votre message. Veuillez réessayer dans quelques instants."
    });
  }
}
