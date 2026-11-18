
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API de vérification de connexion à la base D1
    if (url.pathname === "/api/status") {
      try {
        const result = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all();

        return Response.json({
          success: true,
          message: "Connexion à la base POSY2SECURITY réussie.",
          tables: result.results
        });
      } catch (error) {
        return Response.json({
          success: false,
          message: "Erreur de connexion à la base de données."
        }, { status: 500 });
      }
    }

    // Affichage du site
    return env.ASSETS.fetch(request);
  }
};
