// Interface NUÉE — télémétrie, lieux-dits, carnet de relevés, intro
import { POIS, RING_RADIUS } from './world.js';

// ————— catalogue des relevés —————
const CATALOG = [
  { id: 'poi:La Cathédrale', name: 'La Cathédrale', cat: 'lieux' },
  { id: 'poi:Les Aiguilles', name: 'Les Aiguilles', cat: 'lieux' },
  { id: 'poi:La Mer de Lait', name: 'La Mer de Lait', cat: 'lieux' },
  { id: "poi:L'Anneau", name: "L'Anneau", cat: 'lieux' },
  { id: 'poi:Le Phare', name: 'Le Phare', cat: 'lieux' },
  { id: 'poi:Les Arches', name: 'Les Arches', cat: 'lieux' },
  { id: 'creature:walker', name: 'Porteur', cat: 'faune' },
  { id: 'creature:medusa', name: 'Méduse céleste', cat: 'faune' },
  { id: 'creature:manta', name: 'Raie céleste', cat: 'faune' },
  { id: 'biome:prairie', name: 'Prairie de lichen', cat: 'biomes' },
  { id: 'biome:desert', name: 'Désert minéral', cat: 'biomes' },
  { id: 'biome:fongique', name: 'Forêt fongique', cat: 'biomes' },
  { id: 'biome:coraux', name: 'Champ de coraux', cat: 'biomes' },
  { id: 'biome:lande', name: 'Lande lavande', cat: 'biomes' },
  { id: 'biome:vasiere', name: 'Vasière', cat: 'biomes' },
];

export class Journal {
  constructor(onRecord) {
    this.onRecord = onRecord;
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem('nuee-journal') || '[]'));
    } catch { this.seen = new Set(); }
    this.biomeId = null;
    this.biomeTime = 0;
  }

  get count() { return CATALOG.filter((e) => this.seen.has(e.id)).length; }
  get total() { return CATALOG.length; }

  record(id) {
    if (!CATALOG.some((e) => e.id === id) || this.seen.has(id)) return false;
    this.seen.add(id);
    try { localStorage.setItem('nuee-journal', JSON.stringify([...this.seen])); } catch {}
    const entry = CATALOG.find((e) => e.id === id);
    if (this.onRecord) this.onRecord(entry);
    return true;
  }

  // séjour prolongé dans un biome → relevé
  tickBiome(id, dt) {
    if (id !== this.biomeId) { this.biomeId = id; this.biomeTime = 0; return; }
    this.biomeTime += dt;
    if (this.biomeTime > 4) this.record('biome:' + id);
  }
}

export class UI {
  constructor() {
    this.intro = document.getElementById('intro');
    this.hud = document.getElementById('hud');
    this.tAlt = document.getElementById('t-alt');
    this.tVit = document.getElementById('t-vit');
    this.tCap = document.getElementById('t-cap');
    this.tEnergie = document.getElementById('t-energie');
    this.tReleves = document.getElementById('t-releves');
    this.poi = document.getElementById('poi');
    this.poiName = document.getElementById('poi-name');
    this.poiSub = document.getElementById('poi-sub');
    this.toast = document.getElementById('toast');
    this.journalEl = document.getElementById('journal');
    this.journalList = document.getElementById('journal-list');
    this.journalCount = document.getElementById('journal-count');
    this.hidden = false;
    this.lastSeen = new Map(); // poi.name → timestamp
    this.currentPoi = null;
    this.poiTimer = 0;
    this.toastTimer = 0;

    this.journal = new Journal((entry) => {
      this.toast.innerHTML = 'relevé enregistré — <b>' + entry.name + '</b>';
      this.toast.style.opacity = '0.95';
      this.toastTimer = 3.4;
      this.refreshJournal();
      if (this.onRecord) this.onRecord(entry);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') {
        this.hidden = !this.hidden;
        this.hud.classList.toggle('hidden', this.hidden);
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        this.journalEl.classList.toggle('hidden');
        this.refreshJournal();
      }
    });
    this.refreshJournal();
  }

  refreshJournal() {
    const cats = ['lieux', 'faune', 'biomes'];
    let html = '';
    for (const cat of cats) {
      html += '<div class="cat">' + cat + '</div>';
      for (const e of CATALOG.filter((c) => c.cat === cat)) {
        const known = this.journal.seen.has(e.id);
        html += '<div class="row' + (known ? '' : ' unknown') + '"><span>'
          + (known ? e.name : '· · ·')
          + '</span><span class="dot">' + (known ? '●' : '—') + '</span></div>';
      }
    }
    this.journalList.innerHTML = html;
    this.journalCount.textContent = this.journal.count + ' / ' + this.journal.total;
    this.tReleves.textContent = this.journal.count + '/' + this.journal.total;
  }

  enterGame() {
    this.intro.classList.add('hidden');
    if (!this.hidden) this.hud.classList.remove('hidden');
  }

  exitGame() {
    this.intro.classList.remove('hidden');
    this.intro.querySelector('.enter').textContent = 'cliquer pour reprendre la dérive';
    this.hud.classList.add('hidden');
  }

  update(dt, t, player, running = true) {
    this.tAlt.textContent = Math.round(player.alt ?? 0) + ' u';
    this.tVit.textContent = Math.round(player.speed * 3.6) + ' n';
    this.tCap.textContent = String(Math.round(player.heading ?? 0)).padStart(3, '0') + '°';
    this.tEnergie.style.transform = 'scaleX(' + (player.energy ?? 1).toFixed(3) + ')';
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.style.opacity = '0';
    }

    // détection des lieux-dits — uniquement en jeu
    if (!running) return;
    let found = null;
    for (const p of POIS) {
      let d;
      if (p.ring) {
        d = Math.abs(Math.hypot(player.pos.x, player.pos.z) - p.ring);
      } else {
        d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      }
      if (d < p.r) { found = p; break; }
    }
    if (found && found !== this.currentPoi) {
      const last = this.lastSeen.get(found.name) ?? -999;
      if (t - last > 75) {
        this.currentPoi = found;
        this.lastSeen.set(found.name, t);
        this.poiName.textContent = found.name;
        this.poiSub.textContent = found.sub;
        this.poi.classList.add('show');
        this.poiTimer = 5;
        this.journal.record('poi:' + found.name);
      }
    }
    if (!found) this.currentPoi = null;
    if (this.poiTimer > 0) {
      this.poiTimer -= dt;
      if (this.poiTimer <= 0) this.poi.classList.remove('show');
    }
  }
}
