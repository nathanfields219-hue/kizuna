// Kizuna — le site du jeu : téléchargement, maps, classement et profils.
// Il parle au même serveur que le jeu (Supabase) : les comptes, les maps et les
// scores sont les mêmes. Pages (dans l'adresse après #) : / , /maps, /map/<id>,
// /classement, /joueur/<@>, /compte, /telecharger.
(() => {
  "use strict";
  const C = window.KIZUNA;
  const sb = window.supabase.createClient(C.url, C.anonKey);
  const TIERS = [
    { k: "easy", n: "Hinari", c: "#4ade80" }, { k: "moyen", n: "Kazuro", c: "#38bdf8" },
    { k: "hard", n: "Rokuza", c: "#fb923c" }, { k: "tempete", n: "Tsumeka", c: "#f43f5e" },
    { k: "abysse", n: "Yomirai", c: "#a855f7" }, { k: "eternite", n: "Zenkaru", c: "#fde047" },
  ];
  const TIER = Object.fromEntries(TIERS.map((t) => [t.k, t]));
  const MAP_FIELDS = "id,deezer_id,title,artist,bpm,duration,tiers,plays,cover,created_at";
  const PROFILE_FIELDS = "id,pseudo,handle,avatar_url,banner_url,created_at";
  const view = document.getElementById("view");
  let me = null;          // mon profil quand je suis connecté
  let myEmail = "";
  let renderId = 0;       // évite qu'une ancienne page s'affiche après un changement rapide

  // --- outils ---------------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rixFor = (stars) => Math.round(stars * stars * 2 + stars * 4);   // même calcul que le jeu et le serveur
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
  const fmtNum = (n) => Number(n || 0).toLocaleString("fr-FR");
  const plural = (n, w) => `${fmtNum(n)} ${w}${Number(n) > 1 ? "s" : ""}`;
  const $ = (sel, root = document) => root.querySelector(sel);

  // hash d'un texte comme dans le jeu (djb2), pour retrouver les mêmes couleurs
  function godotHash(s) {
    let h = 5381;
    for (const ch of String(s)) h = (((h << 5) + h) + ch.codePointAt(0)) >>> 0;
    return h;
  }
  function hsv(h, s, v) {
    const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return `rgb(${Math.round(f(5) * 255)},${Math.round(f(3) * 255)},${Math.round(f(1) * 255)})`;
  }

  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("on"), 2600);
  }

  // photo de profil ronde ; sans photo, l'initiale sur un rond coloré (comme dans le jeu)
  function avatar(p, cls = "") {
    const name = p?.pseudo || "?";
    if (p?.avatar_url) return `<span class="av ${cls}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy"></span>`;
    const bg = hsv((godotHash(name) % 360) / 360, 0.35, 0.35);
    return `<span class="av ${cls}" style="background:${bg}">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  }

  // bannière par défaut : ciel de nuit à la couleur du joueur, avec des étoiles (comme dans le jeu)
  function defaultBanner(handle) {
    const cv = document.createElement("canvas");
    cv.width = 1500; cv.height = 500;
    const g = cv.getContext("2d");
    const h = 0.58 + (godotHash(handle) % 100) / 100 * 0.34;
    const grad = g.createLinearGradient(0, 0, 1500 * 0.6, 500 * 1.2);
    grad.addColorStop(0, hsv(h, 0.55, 0.42));
    grad.addColorStop(1, hsv((h + 0.12) % 1, 0.6, 0.16));
    g.fillStyle = grad;
    g.fillRect(0, 0, 1500, 500);
    let seed = godotHash(handle) || 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 160; i++) {
      g.globalAlpha = 0.3 + rnd() * 0.6;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(rnd() * 1500, rnd() * 500, 0.8 + rnd() * 2.4, 0, Math.PI * 2);
      g.fill();
    }
    return cv.toDataURL("image/jpeg", 0.85);
  }

  function tierDots(tiers) {
    let lo = 99, hi = 0;
    const dots = TIERS.map((t) => {
      const has = tiers && tiers[t.k];
      if (has) { lo = Math.min(lo, +has.stars || 0); hi = Math.max(hi, +has.stars || 0); }
      return `<i style="${has ? `background:${t.c}` : ""}"></i>`;
    }).join("");
    return `<div class="dots">${dots}${hi > 0 ? `<em>★ ${lo.toFixed(1)}–${hi.toFixed(1)}</em>` : ""}</div>`;
  }

  function mapCard(m) {
    return `<a class="card map-card fade-in" href="#/map/${esc(m.id)}">
      <div class="cover">${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy">` : ""}<span class="dur">${fmtDur(m.duration)}</span></div>
      <h3>${esc(m.title)}</h3><p class="artist">${esc(m.artist)}</p>
      ${tierDots(m.tiers)}
      <div class="by"><span class="plays">${plural(m.plays, "partie")}</span></div>
    </a>`;
  }

  const gradeCls = (g) => `grade g-${esc(String(g || "F").slice(0, 1))}`;
  const ICON = {
    note: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    bars: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    duel: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
    star: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    down: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/></svg>',
  };

  // --- ciel animé (comme le fond du jeu) ----------------------------------------------
  function startSky() {
    const cv = $("#sky");
    const g = cv.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, t = 0, mx = 0, my = 0, px = 0, py = 0;
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const stars = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), r: 0.5 + rnd() * 1.1, d: 0.2 + rnd() * 0.8, ph: rnd() * 6.28, a: 0.25 + rnd() * 0.65 }));
    const blobs = Array.from({ length: 7 }, () => ({ x: rnd(), y: rnd(), r: 0.25 + rnd() * 0.35, a: 0.05 + rnd() * 0.08, s: 0.3 + rnd() * 0.7 }));
    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function frame() {
      t += 1 / 60;
      px += (mx - px) * 0.04; py += (my - py) * 0.04;
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#14111d"); bg.addColorStop(1, "#060509");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (const b of blobs) {
        const x = (b.x * w + Math.sin(t * 0.05 * b.s) * 60 - px * 40) , y = (b.y * h + Math.cos(t * 0.04 * b.s) * 40 - py * 30);
        const rr = b.r * Math.max(w, h);
        const rg = g.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, `rgba(173,153,219,${b.a})`); rg.addColorStop(1, "rgba(173,153,219,0)");
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
      }
      g.fillStyle = "#fff";
      for (const s of stars) {
        let x = s.x * w - px * 40 * s.d, y = s.y * h - py * 40 * s.d;
        x = ((x % w) + w) % w; y = ((y % h) + h) % h;
        g.globalAlpha = s.a * (still ? 0.85 : 0.65 + 0.35 * Math.sin(t * (0.8 + s.d) + s.ph));
        g.beginPath(); g.arc(x, y, s.r * (0.6 + 0.4 * s.d), 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      if (!still && !document.hidden) requestAnimationFrame(frame);
    }
    addEventListener("resize", () => { size(); if (still) frame(); });
    addEventListener("pointermove", (e) => { mx = e.clientX / w - 0.5; my = e.clientY / h - 0.5; });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !still) requestAnimationFrame(frame); });
    size(); frame();
  }

  // --- compte connecté -----------------------------------------------------------------
  async function loadMe() {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    myEmail = user?.email || "";
    me = null;
    if (user) {
      const r = await sb.from("profiles").select(PROFILE_FIELDS).eq("id", user.id).maybeSingle();
      me = r.data || { id: user.id, incomplete: true };
    }
    const chip = $("#me");
    if (me && !me.incomplete) {
      chip.href = `#/joueur/${encodeURIComponent(me.handle)}`;
      chip.innerHTML = `<span>${esc(me.pseudo)}</span>${avatar(me)}`;
    } else {
      chip.href = "#/compte";
      chip.textContent = me ? "Finir mon profil" : "Se connecter";
    }
  }

  // --- pages -------------------------------------------------------------------------
  const pages = { "": home, maps, map: mapPage, classement: board, joueur: player, compte: account, telecharger: download };

  async function route() {
    const [page, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
    const arg = decodeURIComponent(rest.join("/"));
    const fn = pages[page] || home;
    for (const a of document.querySelectorAll("[data-page]")) {
      a.classList.toggle("on", a.dataset.page === (page || "home") || (page === "map" && a.dataset.page === "maps"));
    }
    const id = ++renderId;
    view.innerHTML = `<div class="wrap"><div class="skeleton" style="height:320px;margin-top:40px"></div></div>`;
    try {
      const html = await fn(arg, id);
      if (id !== renderId || html === undefined) return;
      view.innerHTML = html;
      fn.after?.(arg);
    } catch (e) {
      console.error(e);
      if (id === renderId) view.innerHTML = `<div class="wrap empty">Le serveur ne répond pas. Réessaie dans un moment.</div>`;
    }
    scrollTo({ top: 0 });
  }

  async function latestVersion() {
    try {
      const r = await fetch(`${C.url}/storage/v1/object/public/releases/latest.json?t=${Date.now()}`);
      if (r.ok) return (await r.json()).version || "";
    } catch (_) { /* hors ligne */ }
    return "";
  }

  function downloadButton(version, big = true) {
    const meta = `Windows 10 / 11${version ? ` · v${esc(version)}` : ""} · ${esc(C.downloadSize)}`;
    const btn = C.download
      ? `<a class="btn btn-light ${big ? "btn-big" : ""}" href="${esc(C.download)}" download>${ICON.down}Télécharger Kizuna</a>`
      : `<span class="btn btn-light ${big ? "btn-big" : ""}" aria-disabled="true" style="opacity:.6">${ICON.down}Bientôt disponible</span>`;
    return { btn, meta };
  }

  // Accueil : présentation, téléchargement, chiffres, meilleurs joueurs, dernières maps
  async function home() {
    const [version, players, mapsR, top, latest] = await Promise.all([
      latestVersion(),
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("maps").select("plays").not("deezer_id", "is", null),
      sb.from("leaderboard").select("*").order("rix", { ascending: false }).order("total", { ascending: false }).limit(5),
      sb.from("maps").select(MAP_FIELDS).not("deezer_id", "is", null).order("created_at", { ascending: false }).limit(5),
    ]);
    const nMaps = mapsR.data?.length || 0;
    const nPlays = (mapsR.data || []).reduce((s, m) => s + (m.plays || 0), 0);
    const d = downloadButton(version);
    const topRows = (top.data || []).map((p, i) => `<tr class="row" data-go="#/joueur/${esc(encodeURIComponent(p.handle))}">
      <td class="rank">#${i + 1}</td><td><div class="player">${avatar(p)}<div>${esc(p.pseudo)}<small>@${esc(p.handle)}</small></div></div></td>
      <td class="num rix">${fmtNum(p.rix)} Rix</td></tr>`).join("");
    return `
    <section class="hero"><div class="wrap fade-in">
      <img class="hero-logo" src="logo.png" alt="Logo de Kizuna">
      <h1>kizuna</h1>
      <p class="tag">Le jeu de rythme où la balle rebondit sur ta musique. Choisis n'importe quel titre, frappe au bon moment.</p>
      <div class="hero-actions">${d.btn}<a class="btn btn-big" href="#/maps">Voir les maps</a></div>
      <p class="meta">${d.meta} · gratuit</p>
      <div class="stats">
        <div class="card stat"><b>${fmtNum(players.count || 0)}</b><span>joueurs</span></div>
        <div class="card stat"><b>${fmtNum(nMaps)}</b><span>maps partagées</span></div>
        <div class="card stat"><b>${fmtNum(nPlays)}</b><span>parties jouées</span></div>
      </div>
    </div></section>

    <section class="section wrap">
      <h2>Comment ça marche</h2><p class="sub">Une balle, une barre, ta musique.</p>
      <div class="features">
        <div class="card feature"><div class="ic">${ICON.note}</div><h3>Toutes tes musiques</h3><p>Cherche un titre ou un artiste dans le jeu : la musique complète arrive avec sa pochette et ses maps créées en rythme.</p></div>
        <div class="card feature"><div class="ic">${ICON.bars}</div><h3>6 niveaux par map</h3><p>Du plus calme au plus fou.</p><div class="tiers-row">${TIERS.map((t) => `<span class="tier-pill" style="color:${t.c}">${t.n}</span>`).join("")}</div></div>
        <div class="card feature"><div class="ic">${ICON.duel}</div><h3>Duels en 1 contre 1</h3><p>Défie un ami sur la même map : vos scores défilent en direct pendant la partie.</p></div>
        <div class="card feature"><div class="ic">${ICON.star}</div><h3>Rix et classement</h3><p>Chaque niveau fini rapporte des Rix une seule fois. Plus c'est dur, plus ça rapporte.</p></div>
      </div>
    </section>

    <section class="section wrap two">
      <div><h2>Meilleurs joueurs</h2><p class="sub"><a href="#/classement">Tout le classement →</a></p>
        <div class="card">${topRows ? `<table class="table"><tbody>${topRows}</tbody></table>` : `<p class="empty">Personne pour l'instant. À toi de jouer !</p>`}</div></div>
      <div><h2>Pour jouer</h2><p class="sub">Trois étapes, et c'est parti.</p>
        <ol class="steps">
          <li class="card"><div><b>Télécharge le jeu</b><span>Un zip pour Windows : décompresse-le où tu veux.</span></div></li>
          <li class="card"><div><b>Lance Kizuna.exe</b><span>Si Windows affiche un avertissement : « Informations complémentaires » puis « Exécuter quand même ».</span></div></li>
          <li class="card"><div><b>Crée ton compte</b><span>Le même compte marche ici, sur le site, pour ton profil.</span></div></li>
        </ol></div>
    </section>

    <section class="section wrap">
      <h2>Dernières maps</h2><p class="sub"><a href="#/maps">Toutes les maps →</a></p>
      ${(latest.data || []).length ? `<div class="grid">${latest.data.map(mapCard).join("")}</div>` : `<p class="card empty">Pas encore de map : ajoute une musique dans le jeu avec la recherche.</p>`}
    </section>`;
  }

  // Téléchargement : bouton, configuration, installation, mises à jour
  async function download() {
    const version = await latestVersion();
    const d = downloadButton(version);
    return `<div class="wrap">
      <div class="page-head"><div><h1>Télécharger Kizuna</h1><p>Gratuit, pour Windows.</p></div></div>
      <div class="card" style="padding:32px;display:flex;flex-wrap:wrap;gap:28px;align-items:center">
        <img src="logo.png" alt="" style="width:140px;border-radius:30px;box-shadow:0 0 60px rgba(173,153,219,.4)">
        <div style="flex:1;min-width:240px"><h2 style="margin:0 0 6px;font-size:28px">Kizuna pour Windows</h2>
          <p class="muted" style="margin:0 0 18px">${d.meta}</p>${d.btn}</div>
      </div>
      <section class="section two">
        <div><h2>Installation</h2><p class="sub">Pas d'installateur : tout est dans le dossier.</p>
          <ol class="steps">
            <li class="card"><div><b>Décompresse Kizuna.zip</b><span>Clic droit → « Extraire tout », dans le dossier de ton choix (Bureau, Documents…).</span></div></li>
            <li class="card"><div><b>Lance Kizuna.exe</b><span>Windows peut prévenir que l'application est inconnue : « Informations complémentaires » → « Exécuter quand même ».</span></div></li>
            <li class="card"><div><b>Crée ton compte</b><span>Photo, pseudo, @, mail et mot de passe. Tu peux ensuite te connecter ici avec le même compte.</span></div></li>
          </ol></div>
        <div><h2>Mises à jour</h2><p class="sub">Rien à retélécharger.</p>
          <div class="card" style="padding:22px;line-height:1.6">Quand une nouvelle version sort, une fenêtre <b>Mise à jour</b> s'ouvre au lancement du jeu : <b>Installer</b> la télécharge et relance le jeu tout seul.
          <p class="muted" style="margin:14px 0 0">Il faut une connexion internet pour jouer en ligne (compte, maps partagées, classement, duels).</p></div></div>
      </section></div>`;
  }

  // Maps : recherche, tri, grille
  const SORTS = [["created_at", false, "Récentes"], ["plays", false, "Populaires"], ["title", true, "Titre"], ["bpm", false, "BPM"], ["duration", false, "Durée"]];
  let mapSort = 0, mapQuery = "";
  async function maps() {
    return `<div class="wrap">
      <div class="page-head"><div><h1>Maps</h1><p id="map-count">…</p></div></div>
      <div class="toolbar">
        <div class="chips" id="sorts">${SORTS.map((s, i) => `<button class="chip ${i === mapSort ? "on" : ""}" data-i="${i}">${s[2]}</button>`).join("")}</div>
        <input class="field" id="map-q" type="search" placeholder="Titre ou artiste" value="${esc(mapQuery)}" aria-label="Rechercher une map">
      </div>
      <div id="map-grid"></div></div>`;
  }
  maps.after = () => {
    const load = async () => {
      const grid = $("#map-grid");
      if (!grid) return;
      grid.innerHTML = `<div class="grid">${'<div class="skeleton" style="aspect-ratio:.68"></div>'.repeat(10)}</div>`;
      const [col, asc] = SORTS[mapSort];
      let req = sb.from("maps").select(MAP_FIELDS).not("deezer_id", "is", null).order(col, { ascending: asc }).limit(150);
      const q = mapQuery.trim().replace(/[,()*%]/g, " ").trim();
      if (q) req = req.or(`title.ilike.*${q}*,artist.ilike.*${q}*`);
      const { data, error } = await req;
      if (!$("#map-grid")) return;
      if (error) { grid.innerHTML = `<p class="card empty">Le serveur ne répond pas.</p>`; return; }
      $("#map-count").textContent = data.length ? `${plural(data.length, "map")} partagée${data.length > 1 ? "s" : ""} par les joueurs` : "";
      grid.innerHTML = data.length ? `<div class="grid">${data.map(mapCard).join("")}</div>`
        : `<p class="card empty">${q ? "Aucune map trouvée." : "Pas encore de map : ajoute une musique dans le jeu avec la recherche."}</p>`;
    };
    $("#sorts").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      mapSort = +b.dataset.i;
      for (const c of document.querySelectorAll("#sorts .chip")) c.classList.toggle("on", c === b);
      load();
    });
    let timer;
    $("#map-q").addEventListener("input", (e) => { mapQuery = e.target.value; clearTimeout(timer); timer = setTimeout(load, 300); });
    load();
  };

  // Une map : en-tête (pochette floutée derrière), les 6 niveaux, le top de chaque niveau
  async function mapPage(id) {
    const { data: m } = await sb.from("maps").select(MAP_FIELDS).eq("id", id).maybeSingle();
    if (!m) return `<div class="wrap empty">Map introuvable.</div>`;
    const tiers = m.tiers || {};
    const first = TIERS.find((t) => tiers[t.k] && t.k === "moyen") || TIERS.find((t) => tiers[t.k]) || TIERS[0];
    const tabs = TIERS.map((t) => {
      const has = tiers[t.k];
      return `<button class="tier-tab ${t.k === first.k ? "on" : ""}" style="color:${t.c}" data-k="${t.k}" ${has ? "" : "disabled"}>
        <span>${t.n}</span><small>${has ? `★ ${(+has.stars).toFixed(2)} · ${rixFor(+has.stars)} Rix` : "—"}</small></button>`;
    }).join("");
    mapPage.first = first.k;
    return `<div class="wrap">
      <div class="map-hero fade-in"><div class="blur" style="background-image:url('${esc(m.cover)}')"></div>
        <div class="in">${m.cover ? `<img class="big" src="${esc(m.cover)}" alt="">` : ""}
          <div><h1>${esc(m.title)}</h1><p class="artist">${esc(m.artist)}</p>
            <div class="facts"><span class="fact">${Math.round(m.bpm || 0)} BPM</span><span class="fact">${fmtDur(m.duration)}</span>
              <span class="fact">${plural(m.plays, "partie")}</span></div>
            <p class="muted" style="margin:14px 0 0;font-size:14px">Pour la jouer : dans le jeu, page <b>Maps</b>, cherche « ${esc(m.title)} ».</p></div></div></div>
      <div class="tier-tabs" id="tabs">${tabs}</div>
      <div class="card" id="top"></div></div>`;
  }
  mapPage.after = (id) => {
    const load = async (k) => {
      const box = $("#top");
      box.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
      const { data } = await sb.from("scores").select("score,accuracy,grade,mods,max_combo,user:profiles(id,pseudo,handle,avatar_url)")
        .eq("map_id", id).eq("difficulty", k).order("score", { ascending: false }).limit(50);
      if (!$("#top")) return;
      if (!data?.length) { box.innerHTML = `<p class="empty">Personne n'a encore fini ce niveau. Sois le premier !</p>`; return; }
      box.innerHTML = `<table class="table"><thead><tr><th>#</th><th>Joueur</th><th class="num">Score</th><th class="num hide-sm">Précision</th><th class="num hide-sm">Combo</th><th>Note</th></tr></thead><tbody>
        ${data.map((s, i) => `<tr class="row ${me && s.user?.id === me.id ? "mine" : ""}" data-go="#/joueur/${esc(encodeURIComponent(s.user?.handle || ""))}">
          <td class="rank">${i + 1}</td>
          <td><div class="player">${avatar(s.user)}<div>${esc(s.user?.pseudo)}<small>@${esc(s.user?.handle)}${s.mods ? ` · ${esc(s.mods)}` : ""}</small></div></div></td>
          <td class="num rix">${fmtNum(s.score)}</td><td class="num hide-sm">${(+s.accuracy).toFixed(2)} %</td>
          <td class="num hide-sm">${fmtNum(s.max_combo)}</td><td><span class="${gradeCls(s.grade)}">${esc(s.grade)}</span></td></tr>`).join("")}
        </tbody></table>`;
    };
    $("#tabs").addEventListener("click", (e) => {
      const b = e.target.closest(".tier-tab");
      if (!b || b.disabled) return;
      for (const t of document.querySelectorAll(".tier-tab")) t.classList.toggle("on", t === b);
      load(b.dataset.k);
    });
    load(mapPage.first);
  };

  // Classement : podium puis tableau
  async function board() {
    const { data } = await sb.from("leaderboard").select("*").order("rix", { ascending: false }).order("total", { ascending: false }).limit(300);
    const rows = data || [];
    const pod = (p, i) => p ? `<a class="card pod p${i + 1} fade-in" href="#/joueur/${esc(encodeURIComponent(p.handle))}">
      ${avatar(p)}<span class="place">${["1ER", "2E", "3E"][i]}</span><b>${esc(p.pseudo)}</b><span class="handle">@${esc(p.handle)}</span><br><span class="rix">${fmtNum(p.rix)} Rix</span></a>` : "<div></div>";
    const table = rows.map((p, i) => `<tr class="row ${me && p.id === me.id ? "mine" : ""}" data-go="#/joueur/${esc(encodeURIComponent(p.handle))}">
      <td class="rank">#${i + 1}</td><td><div class="player">${avatar(p)}<div>${esc(p.pseudo)}<small>@${esc(p.handle)}</small></div></div></td>
      <td class="num rix">${fmtNum(p.rix)}</td><td class="num hide-sm">${fmtNum(p.maps_played)}</td>
      <td class="num hide-sm">${p.maps_played > 0 ? `${(+p.accuracy).toFixed(1)} %` : "—"}</td><td class="num hide-sm">${fmtNum(p.total)}</td></tr>`).join("");
    return `<div class="wrap">
      <div class="page-head"><div><h1>Classement</h1><p>Tous les joueurs, par Rix. Chaque niveau fini en rapporte une seule fois.</p></div></div>
      ${rows.length ? `<div class="podium">${pod(rows[1], 1)}${pod(rows[0], 0)}${pod(rows[2], 2)}</div>
      <div class="card"><table class="table"><thead><tr><th>Rang</th><th>Joueur</th><th class="num">Rix</th><th class="num hide-sm">Maps finies</th><th class="num hide-sm">Précision</th><th class="num hide-sm">Score total</th></tr></thead>
      <tbody>${table}</tbody></table></div>` : `<p class="card empty">Personne pour l'instant.</p>`}</div>`;
  }

  // Profil d'un joueur : bannière, photo, Rix, stats, meilleurs scores ; le mien se modifie
  async function player(handle) {
    const { data: p } = await sb.from("profiles").select(PROFILE_FIELDS).eq("handle", handle.toLowerCase()).maybeSingle();
    if (!p) return `<div class="wrap empty">Joueur introuvable.</div>`;
    const [lb, sc] = await Promise.all([
      sb.from("leaderboard").select("id,rix,total,maps_played,accuracy").order("rix", { ascending: false }).order("total", { ascending: false }).limit(1000),
      sb.from("scores").select("difficulty,score,accuracy,grade,rix,mods,created_at,map:maps(id,title,artist,cover)").eq("user_id", p.id).order("score", { ascending: false }).limit(40),
    ]);
    const all = lb.data || [];
    const idx = all.findIndex((r) => r.id === p.id);
    const st = idx >= 0 ? all[idx] : { rix: 0, maps_played: 0, accuracy: 0 };
    const mine = me && me.id === p.id;
    const banner = p.banner_url || defaultBanner(p.handle);
    const scores = (sc.data || []).map((s) => {
      const t = TIER[s.difficulty] || { n: s.difficulty, c: "#fff" };
      return `<a class="score-row" href="#/map/${esc(s.map?.id)}">${s.map?.cover ? `<img src="${esc(s.map.cover)}" alt="" loading="lazy">` : `<span class="no-cover">${ICON.note}</span>`}
        <div class="t"><b>${esc(s.map?.title)}</b><span>${esc(s.map?.artist)} · <span style="color:${t.c};font-weight:800">${esc(t.n)}</span>${s.rix ? ` · +${s.rix} Rix` : ""}</span></div>
        <span class="${gradeCls(s.grade)}">${esc(s.grade)}</span>
        <div class="sc">${fmtNum(s.score)}<small>${(+s.accuracy).toFixed(2)} %</small></div></a>`;
    }).join("");
    player.p = p;
    return `<div class="wrap"><div class="card profile fade-in">
      <div class="banner" style="background-image:url('${esc(banner)}')"></div>
      <div class="pro-head">${avatar(p)}<div class="names"><h1>${esc(p.pseudo)}</h1><span class="handle">@${esc(p.handle)}</span></div>
        <span class="rix-pill">★ ${fmtNum(st.rix)} Rix</span></div>
      <div class="tiles">
        <div class="tile"><b>${idx >= 0 ? `#${idx + 1}` : "—"}</b><span>Rang</span></div>
        <div class="tile"><b>${fmtNum(st.rix)}</b><span>Rix</span></div>
        <div class="tile"><b>${fmtNum(st.maps_played)}</b><span>Maps finies</span></div>
        <div class="tile"><b>${st.maps_played > 0 ? `${(+st.accuracy).toFixed(1)} %` : "—"}</b><span>Précision</span></div></div>
      ${mine ? `<div class="pro-actions"><button class="btn" id="edit">Modifier le profil</button><button class="btn" id="logout">Se déconnecter</button></div>` : ""}
      <div id="editor"></div>
      <div class="best"><h2>Meilleurs scores</h2>${scores || `<p class="muted">Pas encore de score.</p>`}</div>
    </div></div>`;
  }
  player.after = () => {
    if (!$("#edit")) return;
    $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); await loadMe(); toast("Déconnecté"); location.hash = "#/"; });
    $("#edit").addEventListener("click", () => openEditor(player.p));
  };

  // Modification du profil : comme dans le jeu, d'abord le mot de passe, puis
  // bannière, photo et pseudo (le @ ne change jamais)
  function openEditor(p) {
    const box = $("#editor");
    box.innerHTML = `<div class="best"><div class="card" style="padding:22px;max-width:460px">
      <h2 style="margin-top:0">Mot de passe</h2><p class="muted" style="margin-top:0">Pour modifier ton profil, redonne ton mot de passe.</p>
      <form id="lock" style="display:grid;gap:12px"><input class="field" type="password" id="pw" placeholder="Mot de passe" autocomplete="current-password" required>
      <div class="msg" id="lock-msg"></div><button class="btn btn-light">Valider</button></form></div></div>`;
    $("#pw").focus();
    $("#lock").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#lock-msg").textContent = "…";
      const { error } = await sb.auth.signInWithPassword({ email: myEmail, password: $("#pw").value });
      if (error) { $("#lock-msg").textContent = "Mot de passe incorrect."; $("#lock-msg").classList.add("err"); return; }
      editForm(p);
    });
  }

  function editForm(p) {
    let avatarBlob = null, bannerBlob = null;
    const box = $("#editor");
    box.innerHTML = `<div class="best"><form class="card" id="edit-form" style="padding:22px;display:grid;gap:16px">
      <label class="pick-banner" id="pb" style="background-image:url('${esc(p.banner_url || defaultBanner(p.handle))}')"><span>Changer la bannière</span>
        <input type="file" accept="image/*" hidden id="fb"></label>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <label class="pick-avatar" id="pa" style="margin:0">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : ""}<span class="plus">+</span>
          <input type="file" accept="image/*" hidden id="fa"></label>
        <div style="flex:1;min-width:200px"><label class="muted" for="ps" style="font-size:13px">Pseudo d'affichage</label>
          <input class="field" id="ps" maxlength="24" value="${esc(p.pseudo)}" style="margin-top:6px"></div></div>
      <div class="msg" id="edit-msg"></div>
      <div style="display:flex;gap:10px"><button type="button" class="btn" id="cancel">Annuler</button><button class="btn btn-light">Enregistrer</button></div>
    </form></div>`;
    $("#fb").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      bannerBlob = await cropImage(f, 1500, 500, "image/jpeg");
      $("#pb").style.backgroundImage = `url('${URL.createObjectURL(bannerBlob)}')`;
    });
    $("#fa").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      avatarBlob = await cropImage(f, 256, 256, "image/png");
      $("#pa").innerHTML = `<img src="${URL.createObjectURL(avatarBlob)}" alt=""><span class="plus">+</span>`;
      $("#pa").appendChild(e.target);
    });
    $("#cancel").addEventListener("click", () => { box.innerHTML = ""; });
    $("#edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#edit-msg");
      const pseudo = $("#ps").value.trim();
      if (pseudo.length < 2 || pseudo.length > 24) { msg.textContent = "Pseudo : entre 2 et 24 caractères."; msg.classList.add("err"); return; }
      msg.classList.remove("err");
      msg.textContent = "Enregistrement…";
      try {
        const body = { pseudo, handle: p.handle };
        if (avatarBlob) body.avatar_url = await upload("avatars", `${p.id}.png`, avatarBlob, "image/png");
        if (bannerBlob) body.banner_url = await upload("banners", `${p.id}.jpg`, bannerBlob, "image/jpeg");
        const { error } = await sb.from("profiles").update(body).eq("id", p.id);
        if (error) throw error;
        await loadMe();
        toast("Profil enregistré");
        route();
      } catch (err) {
        console.error(err);
        msg.textContent = "Impossible d'enregistrer. Réessaie.";
        msg.classList.add("err");
      }
    });
  }

  // image choisie → recadrée au centre aux bonnes dimensions (photo 256 × 256, bannière 1500 × 500)
  async function cropImage(file, w, h, type) {
    const img = await createImageBitmap(file);
    const s = Math.min(img.width / w, img.height / h);
    const cw = w * s, ch = h * s;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (img.width - cw) / 2, (img.height - ch) / 2, cw, ch, 0, 0, w, h);
    return new Promise((res) => cv.toBlob(res, type, 0.88));
  }

  async function upload(bucket, name, blob, type) {
    const { error } = await sb.storage.from(bucket).upload(name, blob, { upsert: true, contentType: type });
    if (error) throw error;
    return `${C.url}/storage/v1/object/public/${bucket}/${name}?v=${Math.floor(Date.now() / 1000)}`;
  }

  // Compte : connexion, création (comme dans le jeu), ou fin du profil
  let authMode = "login";
  async function account() {
    await loadMe();
    if (me && !me.incomplete) { location.hash = `#/joueur/${encodeURIComponent(me.handle)}`; return undefined; }
    const mode = me?.incomplete ? "complete" : authMode;
    const profileFields = `
      <label class="pick-avatar" id="pa"><span class="plus">+</span><input type="file" accept="image/*" hidden id="fa"></label>
      <input class="field" id="ps" placeholder="Pseudo" maxlength="24" required>
      <div class="handle-field"><span>@</span><input class="field" id="hd" placeholder="identifiant" maxlength="20" required></div>`;
    const loginFields = `
      <input class="field" id="em" type="email" placeholder="Adresse mail" autocomplete="email" required>
      <input class="field" id="pw" type="password" placeholder="Mot de passe" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required>`;
    const titles = { login: ["Connexion", "Le même compte que dans le jeu."], signup: ["Créer un compte", "Tu pourras jouer avec dans le jeu."], complete: ["Ton profil", "Il ne manque que ton pseudo et ton @."] };
    return `<div class="wrap"><div class="card auth fade-in">
      <h1>${titles[mode][0]}</h1><p class="sub">${titles[mode][1]}</p>
      <form id="auth">${mode !== "login" ? profileFields : ""}${mode !== "complete" ? loginFields : ""}
        <div class="msg" id="auth-msg"></div>
        <button class="btn btn-light">${{ login: "Se connecter", signup: "Créer mon compte", complete: "C'est parti" }[mode]}</button></form>
      ${mode !== "complete" ? `<div class="switch"><button id="switch">${mode === "login" ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}</button></div>` : ""}
    </div></div>`;
  }
  account.after = () => {
    const form = $("#auth");
    if (!form) return;
    const mode = me?.incomplete ? "complete" : authMode;
    let avatarBlob = null;
    const say = (t, err = true) => { const m = $("#auth-msg"); m.textContent = t; m.classList.toggle("err", err); };
    $("#switch")?.addEventListener("click", () => { authMode = authMode === "login" ? "signup" : "login"; route(); });
    $("#hd")?.addEventListener("input", (e) => {
      const clean = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (clean !== e.target.value) e.target.value = clean;
    });
    $("#fa")?.addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      avatarBlob = await cropImage(f, 256, 256, "image/png");
      $("#pa").innerHTML = `<img src="${URL.createObjectURL(avatarBlob)}" alt=""><span class="plus">+</span>`;
      $("#pa").appendChild(e.target);
    });
    (mode === "complete" ? $("#ps") : $("#em") || $("#ps"))?.focus();

    const finishProfile = async (uid) => {
      const pseudo = $("#ps").value.trim(), handle = $("#hd").value;
      const body = { id: uid, pseudo, handle, avatar_url: "" };
      if (avatarBlob) body.avatar_url = await upload("avatars", `${uid}.png`, avatarBlob, "image/png");
      const { error } = await sb.from("profiles").insert(body);
      if (error) throw error;
    };
    const checkProfile = async () => {
      const pseudo = $("#ps").value.trim(), handle = $("#hd").value;
      if (pseudo.length < 2 || pseudo.length > 24) return "Pseudo : entre 2 et 24 caractères.";
      if (handle.length < 3) return "@ : au moins 3 caractères (lettres, chiffres ou _).";
      const { data } = await sb.from("profiles").select("id").eq("handle", handle);
      if (data?.length) return "Ce @ est déjà pris.";
      return "";
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true;
      say("…", false);
      try {
        if (mode === "login") {
          const { error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
          if (error) { say("Mail ou mot de passe incorrect."); return; }
          await loadMe();
          if (me?.incomplete) { route(); return; }
          toast(`Salut ${me.pseudo} !`);
          location.hash = `#/joueur/${encodeURIComponent(me.handle)}`;
          return;
        }
        const bad = await checkProfile();
        if (bad) { say(bad); return; }
        if (mode === "complete") {
          await finishProfile(me.id);
        } else {
          const email = $("#em").value.trim(), password = $("#pw").value;
          if (password.length < 6) { say("Mot de passe : 6 caractères minimum."); return; }
          const { data, error } = await sb.auth.signUp({ email, password });
          const taken = (error && /already/i.test(error.message)) || (data?.user && data.user.identities?.length === 0);
          if (taken) {
            // ce mail a déjà un compte : on essaie de s'y connecter
            const li = await sb.auth.signInWithPassword({ email, password });
            if (li.error) { authMode = "login"; await route(); $("#em").value = email; say("Ce mail a déjà un compte. Connecte-toi avec ton mot de passe."); return; }
          } else if (error) { say(error.message.includes("password") ? "Mot de passe trop faible." : "Création impossible. Réessaie."); return; }
          const { data: s } = await sb.auth.getSession();
          if (!s.session) { say("Compte créé. Connecte-toi pour finir ton profil.", false); authMode = "login"; return; }
          const existing = await sb.from("profiles").select("id").eq("id", s.session.user.id).maybeSingle();
          if (!existing.data) await finishProfile(s.session.user.id);
        }
        await loadMe();
        toast("Bienvenue sur Kizuna !");
        location.hash = `#/joueur/${encodeURIComponent(me.handle)}`;
      } catch (err) {
        console.error(err);
        say(/handle|unique|duplicate/i.test(err?.message || "") ? "Ce @ est déjà pris." : "Ça n'a pas marché. Réessaie.");
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
  };

  // --- démarrage -----------------------------------------------------------------------
  // lignes de tableau cliquables
  view.addEventListener("click", (e) => {
    const row = e.target.closest("[data-go]");
    if (row && !e.target.closest("a")) location.hash = row.dataset.go;
  });
  addEventListener("hashchange", route);
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") loadMe(); });
  startSky();
  loadMe().finally(route);
})();
