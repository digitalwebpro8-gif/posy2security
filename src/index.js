
const SESSION_DURATION = 8 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 310000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );

  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64(salt)}$${base64(result)}`;
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, iterations, saltValue, expected] = stored.split("$");

    if (algorithm !== "pbkdf2") return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const result = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: fromBase64(saltValue),
        iterations: Number(iterations),
        hash: "SHA-256"
      },
      key,
      256
    );

    const actual = base64(result);

    return actual === expected;
  } catch {
    return false;
  }
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const item = cookies.split(";").map(v => v.trim())
    .find(v => v.startsWith(name + "="));

  return item ? item.substring(name.length + 1) : null;
}

function sessionCookie(token, maxAge) {
  return `posy_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

async function getAdmin(request, env) {
  const token = getCookie(request, "posy_session");
  if (!token) return null;

  const tokenHash = await sha256(token);

  const session = await env.DB.prepare(`
    SELECT a.id, a.nom, a.email, a.role, a.statut
    FROM sessions_admin s
    JOIN administrateurs a ON a.id = s.administrateur_id
    WHERE s.jeton_hash = ?
      AND s.expiration > CURRENT_TIMESTAMP
      AND a.statut = 'actif'
  `).bind(tokenHash).first();

  return session || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Vérification de la connexion D1 et du secret de configuration
      if (path === "/api/status" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT name FROM sqlite_master
          WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `).all();

        return json({
          success: true,
          message: "Connexion à la base POSY2SECURITY réussie.",
          tables: result.results
        });
      }

      // Création initiale désactivée : le compte principal existe déjà.
      if (path === "/api/admin/setup") {
        return json({
          success: false,
          message: "La création initiale des administrateurs est désactivée."
        }, 410);
      }

      // Connexion administrateur
      if (path === "/api/admin/login" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const admin = await env.DB.prepare(`
          SELECT id, nom, email, mot_de_passe_hash, role, statut
          FROM administrateurs
          WHERE email = ?
        `).bind(email).first();

        if (
          !admin ||
          admin.statut !== "actif" ||
          !(await verifyPassword(password, admin.mot_de_passe_hash))
        ) {
          return json({
            success: false,
            message: "Identifiants incorrects."
          }, 401);
        }

        const token = randomToken();
        const tokenHash = await sha256(token);
        const expiration = new Date(Date.now() + SESSION_DURATION)
          .toISOString().replace("T", " ").slice(0, 19);

        await env.DB.prepare(`
          INSERT INTO sessions_admin
            (administrateur_id, jeton_hash, expiration)
          VALUES (?, ?, ?)
        `).bind(admin.id, tokenHash, expiration).run();

        return json({
          success: true,
          message: "Connexion réussie.",
          administrateur: {
            nom: admin.nom,
            email: admin.email,
            role: admin.role
          }
        }, 200, {
          "Set-Cookie": sessionCookie(token, SESSION_DURATION / 1000)
        });
      }

      // Vérification de la session
      if (path === "/api/admin/me" && request.method === "GET") {
        const admin = await getAdmin(request, env);

        if (!admin) {
          return json({
            success: false,
            message: "Session invalide ou expirée."
          }, 401);
        }

        return json({
          success: true,
          administrateur: {
            nom: admin.nom,
            email: admin.email,
            role: admin.role
          }
        });
      }

      // Déconnexion
      if (path === "/api/admin/logout" && request.method === "POST") {
        const token = getCookie(request, "posy_session");

        if (token) {
          await env.DB.prepare(
            "DELETE FROM sessions_admin WHERE jeton_hash = ?"
          ).bind(await sha256(token)).run();
        }

        return json({
          success: true,
          message: "Déconnexion réussie."
        }, 200, {
          "Set-Cookie": sessionCookie("", 0)
        });
      }

      // Affichage des pages du site
      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Erreur API POSY2SECURITY :", error);

      return json({
        success: false,
        message: "Une erreur est survenue sur le serveur."
      }, 500);
    }
  }
};
