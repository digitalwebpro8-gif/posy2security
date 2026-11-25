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
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
  const placeholders = values.map((_, index) => `$${index + 1}`);
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



async function handleQuoteSubmission(req, res) {
  const body = await readJsonBody(req);
  if (clean(body.website, 200)) return res.status(200).json({ success:true, message:"Votre demande a bien été reçue." });

  const nom = clean(body.nom, 160);
  const entreprise = clean(body.entreprise, 180);
  const email = clean(body.email, 254).toLowerCase();
  const telephone = clean(body.telephone, 40);
  const service = clean(body.service, 180);
  const description = clean(body.description, 4000);

  if (!nom || !telephone || !service || description.length < 8) {
    return res.status(400).json({ success:false, message:"Veuillez renseigner votre nom, votre téléphone, le service souhaité et décrire votre besoin (8 caractères minimum)." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success:false, message:"L'adresse e-mail est invalide." });
  }

  const sql = getDb();
  const inserted = await sql`
    INSERT INTO devis (nom, entreprise, email, telephone, service, description, statut, date_creation)
    VALUES (${nom}, ${entreprise || null}, ${email || null}, ${telephone}, ${service}, ${description}, 'nouveau', NOW())
    RETURNING id
  `;
  return res.status(201).json({ success:true, message:"Votre demande de devis a bien été envoyée. Notre équipe vous recontactera.", id:inserted[0].id });
}

async function handleAdminQuotes(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(401).json({ success:false, message:"Connexion administrateur requise." });
  const sql = getDb();
  const devis = await sql`
    SELECT id, nom, entreprise, email, telephone, service, description, statut, date_creation
    FROM devis ORDER BY date_creation DESC, id DESC LIMIT 300
  `;
  return res.status(200).json({ success:true, devis });
}

async function handleAdminContactReply(req, res) {
  let stage = "vérification de la session administrateur";
  try {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return res.status(401).json({ success:false, message:"Connexion administrateur requise." });
  }

  stage = "lecture des données du formulaire";
  const body = await readJsonBody(req);
  const contactId = Number(body.contact_id);
  const reponse = clean(body.reponse, 5000);
  if (!Number.isSafeInteger(contactId) || contactId <= 0 || reponse.length < 2) {
    return res.status(400).json({ success:false, message:"Veuillez sélectionner un message et rédiger une réponse." });
  }

  stage = "recherche du message dans la base de données";
  const sql = getDb();
  const contacts = await sql`
    SELECT id, nom, email, sujet
    FROM contacts
    WHERE id = ${contactId}
    LIMIT 1
  `;
  const contact = contacts[0];
  if (!contact) return res.status(404).json({ success:false, message:"Message introuvable." });
  if (!contact.email) return res.status(400).json({ success:false, message:"Ce contact n'a pas renseigné d'adresse e-mail." });

  stage = "vérification de la clé API Brevo";
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("La variable BREVO_API_KEY n'est pas configurée dans Vercel.");

  stage = "envoi du courriel avec Brevo";
  const subject = clean(body.sujet, 180) || (contact.sujet ? "Re : " + contact.sujet : "Réponse à votre message - POSY2SECURITY");
  const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method:"POST",
    headers:{
      "accept":"application/json",
      "api-key":apiKey,
      "content-type":"application/json"
    },
    body:JSON.stringify({
      sender:{ name:"POSY2SECURITY", email:"digitalwebpro8@gmail.com" },
      to:[{ email:contact.email, name:contact.nom || "Client" }],
      subject,
      textContent:reponse,
      htmlContent:"<div style='font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap'>" +
        reponse.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>") +
        "<br><br><strong>POSY2SECURITY</strong></div>"
    })
  });

  const emailData = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    console.error("Erreur API Brevo:", emailData);
    return res.status(502).json({
      success:false,
      message:emailData.message || "Brevo n'a pas accepté l'envoi. Vérifiez l'expéditeur et les paramètres du compte."
    });
  }

  stage = "enregistrement de la réponse dans Neon";
  await sql`
    INSERT INTO contact_replies (contact_id, destinataire, sujet, reponse, statut_envoi)
    VALUES (${contactId}, ${contact.email}, ${subject}, ${reponse}, 'envoye')
  `;

  stage = "mise à jour du statut du message dans Neon";
  // La table contacts du projet utilise la colonne "statut".
  // Utiliser la requête Neon balisée évite un appel dynamique non nécessaire.
  await sql`
    UPDATE contacts
    SET statut = 'repondu'
    WHERE id = ${contactId}
  `;

  return res.status(200).json({ success:true, message:"Réponse envoyée avec succès.", messageId:emailData.messageId || null });
  } catch (error) {
    console.error("Erreur réponse contact à l’étape:", stage, error?.stack || error?.message || error);
    return res.status(500).json({ success:false, message:"Échec à l’étape : " + stage + ". Aucune nouvelle tentative avant vérification." });
  }
}

async function handleBrevoCheck(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return res.status(401).json({ success:false, message:"Connexion administrateur requise." });
  }
  const variableExists = Object.prototype.hasOwnProperty.call(process.env, "BREVO_API_KEY");
  const variableType = typeof process.env.BREVO_API_KEY;
  const variableLength = variableType === "string" ? process.env.BREVO_API_KEY.length : null;
  const configured = variableType === "string" &&
    process.env.BREVO_API_KEY.trim().length > 0;
  return res.status(200).json({
    success:true,
    brevoKeyConfigured:configured,
    brevoVariableExists:variableExists,
    brevoVariableType:variableType,
    brevoValueLength:variableLength,
    environment:process.env.VERCEL_ENV || "indéterminé",
    deploymentUrl:process.env.VERCEL_URL || "indisponible",
    projectId:process.env.VERCEL_PROJECT_ID || "indisponible",
    repository:process.env.VERCEL_GIT_REPO_SLUG || "indisponible"
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
  const replyRows = await sql`
    SELECT id, contact_id, destinataire, sujet, reponse, statut_envoi, date_envoi
    FROM contact_replies
    ORDER BY date_envoi DESC
    LIMIT 2000
  `;
  const repliesByContact = {};
  for (const reply of replyRows) {
    const key = String(reply.contact_id);
    if (!repliesByContact[key]) repliesByContact[key] = [];
    repliesByContact[key].push(reply);
  }
  const contactsWithReplies = contacts.map(item => ({
    ...item,
    reponses: repliesByContact[String(item.id)] || []
  }));
  return res.status(200).json({ success:true, contacts:contactsWithReplies });
}

export default async function handler(req, res) {
  const mode = String(req.query?.type || "");

  try {
    if (req.method === "POST" && mode === "contact") {
      return await handleContactSubmission(req, res);
    }
    if (req.method === "POST" && mode === "devis") {
      return await handleQuoteSubmission(req, res);
    }
    if (req.method === "GET" && mode === "admin-devis") {
      return await handleAdminQuotes(req, res);
    }
    if (req.method === "GET" && mode === "brevo-check") {
      return await handleBrevoCheck(req, res);
    }
    if (req.method === "GET" && mode === "contacts") {
      return await handleAdminContacts(req, res);
    }
    if (req.method === "POST" && mode === "reply") {
      return await handleAdminContactReply(req, res);
    }
  } catch (error) {
    console.error("Erreur gestion contacts:", error?.stack || error?.message || error);
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
