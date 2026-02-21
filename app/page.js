"use client";

import React, { useMemo, useRef, useState, useCallback } from "react";
import * as htmlToImage from "html-to-image";

/**
 * Cross-platform download strategy (v4 — no popups):
 *
 * 1. Render card → Blob via html-to-image (pixelRatio 3, retry at 2)
 * 2. Desktop / Android: <a download> click → instant file save
 * 3. iOS (ALL browsers — they all use WebKit):
 *    - <a download> is IGNORED by WebKit
 *    - window.open() is blocked as popup or breaks blob URLs cross-context
 *    - SOLUTION: Show the image in a full-screen overlay ON THE SAME PAGE
 *      with -webkit-touch-callout:default so long-press → "Save to Photos" works
 *    - No popups, no new tabs, no blocked windows
 */

const roleConfig = {
  Initiate:            { stars: 1, rarity: "INITIATE",  emoji: "🌱", color: "#2ECC71", colorDark: "#1A7A3A" },
  "Ritty Bitty":       { stars: 2, rarity: "COMMON",    emoji: "🐱", color: "#88BBFF", colorDark: "#4488CC" },
  Ritty:               { stars: 3, rarity: "RARE",      emoji: "🕯️", color: "#AA66FF", colorDark: "#553399" },
  Mage:                { stars: 3, rarity: "MAGE",      emoji: "🔮", color: "#CC44FF", colorDark: "#6622AA" },
  Ritualist:           { stars: 4, rarity: "EPIC",      emoji: "🔥", color: "#FF8833", colorDark: "#CC4400" },
  "Radiant Ritualist": { stars: 5, rarity: "LEGENDARY", emoji: "✦",  color: "#FFD700", colorDark: "#996600" },
};

const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const FONT_TECH = `"Bahnschrift", "DIN Alternate", "Segoe UI", ${FONT_SANS}`;

const LIGHT = {
  bg:      "#F7F5FF",
  surface: "rgba(255,255,255,0.78)",
  surface2:"rgba(255,255,255,0.92)",
  text:    "#1A0A00",
  muted:   "rgba(26,10,0,0.62)",
  purple:  "#7B2FFF",
  pink:    "#FF2F9A",
  gold:    "#FFB800",
};

function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function Star({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

async function waitForImages(rootEl) {
  const imgs = Array.from(rootEl.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        if (!img.complete) {
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        }
        if (img.decode) await img.decode();
      } catch {}
    })
  );
}

function getUA() {
  if (typeof navigator === "undefined") return { ios: false, android: false, mobile: false };
  const ua = navigator.userAgent;
  const ios     = /iP(ad|hone|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  return { ios, android, mobile: ios || android };
}

/** Blob → base64 data URL */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Render card element to PNG blob with automatic retry */
async function renderCardBlob(element, bgColor) {
  try {
    const blob = await htmlToImage.toBlob(element, {
      pixelRatio: 3,
      cacheBust: true,
      backgroundColor: bgColor,
      skipFonts: true,
      fetchRequestInit: { mode: "cors", cache: "no-store" },
    });
    if (blob) return blob;
  } catch {
    // Fall through to retry at lower res
  }
  const blob = await htmlToImage.toBlob(element, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: bgColor,
    skipFonts: true,
  });
  if (!blob) throw new Error("Image export returned null");
  return blob;
}

/** Desktop / Android: single-click anchor download */
function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
    rel: "noopener",
    style: "display:none",
  });
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

/* ─────────────────── iOS Save Overlay Component ─────────────────── */
function IOSSaveOverlay({ dataURL, onClose }) {
  if (!dataURL) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      onClick={onClose}
    >
      {/* Prevent closing when tapping the image */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "none",
            background: "rgba(255,255,255,0.15)",
            color: "#fff",
            fontSize: 20,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100000,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {/* Bouncing arrow */}
        <div
          style={{
            fontSize: 28,
            marginBottom: 12,
            animation: "iosBounce 1.2s ease-in-out infinite",
          }}
        >
          👇
        </div>

        {/* The actual image — long-press to save */}
        <img
          src={dataURL}
          alt="Ritual Card"
          style={{
            maxWidth: "92vw",
            maxHeight: "65vh",
            borderRadius: 14,
            boxShadow: "0 12px 60px rgba(0,0,0,0.7)",
            display: "block",
            WebkitTouchCallout: "default",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        />

        {/* Instructions */}
        <div
          style={{
            marginTop: 18,
            textAlign: "center",
            color: "#fff",
            fontFamily: FONT_SANS,
            lineHeight: 1.6,
          }}
        >
          <div
            style={{
              display: "inline-block",
              background: "rgba(255,215,0,0.15)",
              border: "1px solid rgba(255,215,0,0.3)",
              borderRadius: 12,
              padding: "10px 20px",
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 800, color: "#FFD700", fontSize: 15 }}>
              📸 Hold the image → Save to Photos
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
            Tap anywhere outside to close
          </div>
        </div>
      </div>

      {/* Keyframe animation injected inline */}
      <style>{`
        @keyframes iosBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────── Main Component ─────────────────── */
export default function RitualCardGenerator() {
  const [handle,       setHandle]       = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [loading,      setLoading]      = useState(false);
  const [exporting,    setExporting]    = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [error,        setError]        = useState("");

  // iOS save overlay state
  const [iosSaveDataURL, setIosSaveDataURL] = useState(null);

  const [profile, setProfile] = useState({
    username: "", displayName: "USERNAME", avatarUrl: "",
    bio: "Stay Ritualized", followers: null, following: null, tweets: null,
  });

  const [showCard, setShowCard] = useState(false);
  const stageRef = useRef(null);

  const cfg       = useMemo(() => selectedRole ? roleConfig[selectedRole] : null, [selectedRole]);
  const badgeStyle = useMemo(() => cfg
    ? { color: cfg.color, borderColor: cfg.color, background: `${cfg.color}14` }
    : {}, [cfg]);

  async function generateCard() {
    setError("");
    const username = handle.replace("@", "").trim();
    if (!username)     return setError("Please enter your X/Twitter username");
    if (!selectedRole) return setError("Please select your role");

    setLoading(true);

    let displayName = username, avatarUrl = "", bio = "Stay Ritualized";
    let followers = null, following = null, tweets = null;

    try {
      const res  = await fetch(`https://api.fxtwitter.com/${username}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();

      if (data?.user) {
        const u = data.user;
        displayName = u.name || username;
        avatarUrl   = u.avatar_url || u.profile_image_url_https || u.profile_image_url || (u.avatar && u.avatar.url) || "";
        if (avatarUrl) avatarUrl = avatarUrl.replace("_normal", "_400x400");
        if (avatarUrl) avatarUrl = `/api/img?url=${encodeURIComponent(avatarUrl)}`;
        bio       = u.description || u.bio || bio;
        followers = u.followers_count ?? u.followers ?? null;
        following = u.following_count ?? u.friends_count ?? null;
        tweets    = u.statuses_count ?? u.tweet_count ?? null;
      }
    } catch {}

    setProfile({ username, displayName, avatarUrl, bio, followers, following, tweets });
    setShowCard(true);
    setLoading(false);
  }

  function reset() {
    setShowCard(false);
    setHandle("");
    setSelectedRole("");
    setError("");
    setExportStatus("");
    setIosSaveDataURL(null);
    setProfile({ username: "", displayName: "USERNAME", avatarUrl: "", bio: "Stay Ritualized",
                 followers: null, following: null, tweets: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const download = useCallback(async () => {
    if (!stageRef.current || exporting) return;

    const { ios } = getUA();
    const filename = `ritual-card-${profile.username || "card"}.png`;

    setExporting(true);
    setExportStatus("Rendering…");

    try {
      await new Promise((r) => setTimeout(r, 50));
      await waitForImages(stageRef.current);

      setExportStatus("Exporting image…");

      const blob = await renderCardBlob(stageRef.current, LIGHT.bg);

      if (ios) {
        // ── iOS: show image in same-page overlay (no popup, no new tab) ─────────
        setExportStatus("Preparing…");
        const dataURL = await blobToDataURL(blob);
        setIosSaveDataURL(dataURL);
        setExportStatus("Hold the image to save ✓");
      } else {
        // ── Android + Desktop: direct single-click download ─────────────────────
        setExportStatus("Downloading…");
        anchorDownload(blob, filename);
        setExportStatus("Downloaded! ✓");
      }
    } catch (err) {
      console.error("[RitualCard] download error:", err);
      setExportStatus("Export failed — try again");
    } finally {
      setExporting(false);
      setTimeout(() => setExportStatus(""), 4000);
    }
  }, [exporting, profile.username]);

  const { ios, android } = getUA();
  const btnLabel = exporting
    ? (exportStatus || "Exporting…")
    : ios     ? "💾 Save Image"
    : android ? "💾 Download"
    :           "⬇ Download HD";

  return (
    <div style={styles.page}>
      <div style={styles.ambientBg} aria-hidden="true" />

      {/* iOS save overlay — renders on same page, no popup */}
      <IOSSaveOverlay
        dataURL={iosSaveDataURL}
        onClose={() => setIosSaveDataURL(null)}
      />

      <header style={styles.header}>
        <div style={styles.brandRow}>
          <img src="/logo.png" alt="Ritual" style={styles.siteLogo} />
          <h1 style={styles.h1}>
            Ritual <span style={styles.h1Span}>Card</span>
          </h1>
        </div>
        <p style={styles.subtitle}>Generate your card</p>
      </header>

      {!showCard && (
        <section style={styles.panel}>
          <div style={styles.formGroup}>
            <label style={styles.label}>X / Twitter Username</label>
            <div style={styles.inputWrap}>
              <span style={styles.atPrefix}>@</span>
              <input
                value={handle}
                onChange={e => setHandle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && generateCard()}
                placeholder="yourhandle"
                style={styles.input}
                autoComplete="off"
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Select your role</label>
            <div style={styles.roleGrid}>
              {Object.keys(roleConfig).map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  style={{
                    ...styles.roleBtn,
                    ...(selectedRole === role ? styles.roleBtnActive : null),
                    gridColumn: role === "Radiant Ritualist" ? "span 2" : undefined,
                    borderColor: selectedRole === role ? roleConfig[role].color : styles.roleBtn.borderColor,
                  }}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>
                    {roleConfig[role].emoji} {role}{role === "Radiant Ritualist" ? " ✦" : ""}
                  </span>
                  {selectedRole === role && (
                    <span aria-hidden="true" style={{
                      ...styles.roleBtnGlow,
                      background: `linear-gradient(135deg, ${roleConfig[role].colorDark}, ${roleConfig[role].color})`,
                    }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={generateCard}
            style={{ ...styles.primaryBtn, opacity: loading ? 0.75 : 1 }}
            disabled={loading}
          >
            {loading ? "Fetching profile…" : "Generate card"}
          </button>

          {error && <div style={styles.errorMsg}>{error}</div>}
        </section>
      )}

      {showCard && cfg && (
        <section style={styles.cardWrap}>
          {/* ── Card visual (captured by html-to-image) ── */}
          <div ref={stageRef} style={styles.exportStage}>
            <div style={styles.exportAmbient} aria-hidden="true" />

            <div style={styles.cardOuter}>
              <div style={styles.outerGlow} aria-hidden="true" />
              <div style={styles.frameOuter} aria-hidden="true" />
              <div style={styles.frameInner} aria-hidden="true" />

              {[{ left:14,top:14 },{ right:14,top:14 },{ left:14,bottom:14 },{ right:14,bottom:14 }].map((pos,i) => (
                <div key={i} style={{ ...styles.cornerSpark, ...pos }}>✦</div>
              ))}

              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardHeaderCenter}>
                    <img src="/logo.png" alt="Ritual" style={styles.cardLogoImg} />
                    <span style={styles.ritualLogoText}>RITUAL</span>
                  </div>
                  <span style={{ ...styles.badge, ...badgeStyle }}>{cfg.rarity}</span>
                </div>

                <div style={styles.cardName}>{profile.displayName}</div>

                <div style={styles.avatarSection}>
                  <div style={styles.avatarScreen}>
                    <div style={{
                      ...styles.avatarFrame,
                      borderColor: `${cfg.color}66`,
                      boxShadow: `0 0 0 3px ${cfg.color}18, 0 18px 50px ${cfg.color}14`,
                    }}>
                      {profile.avatarUrl
                        ? <img src={profile.avatarUrl} alt={`${profile.displayName} avatar`} style={styles.avatarImg} crossOrigin="anonymous" />
                        : <div style={styles.avatarPlaceholder}>{cfg.emoji}</div>
                      }
                    </div>
                  </div>
                  <div style={styles.sideHandle}>@{profile.username}</div>
                </div>

                <div style={styles.cardBody}>
                  <div style={styles.starsRow}>
                    {Array.from({ length: cfg.stars }).map((_, i) => <Star key={i} color={cfg.color} />)}
                  </div>

                  <div style={styles.roleLabelRow}>
                    <span style={{ ...styles.roleLabel, ...badgeStyle }}>{selectedRole.toUpperCase()}</span>
                  </div>

                  {profile.followers !== null && (
                    <div style={styles.statsRowSingle}>
                      <div style={styles.statItem}>
                        <div style={styles.statVal}>{fmtNum(profile.followers)}</div>
                        <div style={styles.statLbl}>FOLLOWERS</div>
                      </div>
                    </div>
                  )}

                  <div style={styles.divider} />

                  <div style={styles.sloganBox}>
                    <div style={styles.ritualModeLabel}>◦ Stay Ritualized</div>
                    <div style={styles.bioText}>{profile.bio || "Stay Ritualized"}</div>
                  </div>
                </div>

                <div style={styles.cardFooter}>
                  <span style={styles.footerLabel}>RITUAL · 2026</span>
                  <span style={styles.footerDot} />
                  <span style={styles.footerLabel}>{selectedRole.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div style={styles.actions}>
            <button
              type="button"
              onClick={download}
              disabled={exporting}
              style={{ ...styles.downloadBtn, opacity: exporting ? 0.65 : 1, cursor: exporting ? "wait" : "pointer" }}
            >
              {btnLabel}
            </button>
            <button type="button" onClick={reset} style={styles.secondaryBtn}>
              Make another
            </button>
          </div>

          {/* Status / hint text */}
          {exportStatus && (
            <div style={styles.hint}>
              {exportStatus}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────── styles ─────────────────────────── */
const styles = {
  page: {
    minHeight: "100vh",
    padding: "26px 16px 72px",
    background: LIGHT.bg,
    fontFamily: FONT_SANS,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
    overflowX: "hidden",
    color: LIGHT.text,
  },
  ambientBg: {
    position: "fixed", inset: 0, pointerEvents: "none",
    background:
      "radial-gradient(900px 600px at 20% 0%,rgba(123,47,255,.12),transparent 60%)," +
      "radial-gradient(900px 600px at 80% 10%,rgba(255,47,154,.10),transparent 55%)," +
      "radial-gradient(900px 700px at 50% 90%,rgba(255,184,0,.16),transparent 62%)",
  },
  header:    { textAlign: "center", marginBottom: 16, position: "relative", zIndex: 2 },
  brandRow:  { display: "flex", alignItems: "center", justifyContent: "center", gap: 10 },
  siteLogo:  { width: 44, height: 44, objectFit: "contain" },
  h1:        { margin: 0, fontSize: 30, letterSpacing: 1.0, fontWeight: 750, color: LIGHT.text, fontFamily: FONT_TECH },
  h1Span:    { color: LIGHT.purple },
  subtitle:  { margin: "10px 0 0", fontSize: 12, letterSpacing: .2, color: LIGHT.muted, fontFamily: FONT_MONO },

  panel: {
    width: "100%", maxWidth: 560,
    background: LIGHT.surface,
    border: "1px solid rgba(123,47,255,.10)",
    borderRadius: 20, padding: 22,
    boxShadow: "0 18px 60px rgba(20,10,0,.10)",
    backdropFilter: "blur(10px)",
    position: "relative", zIndex: 2,
  },
  formGroup: { marginBottom: 16, textAlign: "left" },
  label:     { display: "block", fontSize: 12, letterSpacing: .2, fontWeight: 800, color: LIGHT.muted, marginBottom: 8 },
  inputWrap: { display: "flex", border: "1px solid rgba(0,0,0,.10)", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,.86)" },
  atPrefix:  { padding: "12px 12px", fontWeight: 900, color: LIGHT.purple, background: "rgba(123,47,255,.06)", borderRight: "1px solid rgba(0,0,0,.08)" },
  input:     { flex: 1, border: "none", outline: "none", padding: "12px 12px", background: "transparent", fontSize: 14, color: LIGHT.text },

  roleGrid:      { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
  roleBtn:       { position: "relative", overflow: "hidden", borderRadius: 12, border: "1px solid rgba(0,0,0,.10)", background: "rgba(255,255,255,.86)", padding: "12px 12px", cursor: "pointer", fontWeight: 900, color: LIGHT.text },
  roleBtnActive: { color: "white", transform: "translateY(-1px)" },
  roleBtnGlow:   { position: "absolute", inset: 0, opacity: 1 },

  primaryBtn: {
    width: "100%", marginTop: 10, border: "none", cursor: "pointer",
    borderRadius: 12, padding: "14px 14px", fontWeight: 900, letterSpacing: .5,
    color: "white",
    background: `linear-gradient(135deg,${LIGHT.purple},${LIGHT.pink})`,
    boxShadow: "0 14px 36px rgba(123,47,255,.18)",
    fontFamily: FONT_TECH,
  },
  errorMsg: {
    marginTop: 12, padding: "10px 12px", borderRadius: 10,
    background: "rgba(255,60,60,.10)", border: "1px solid rgba(255,60,60,.22)",
    color: "#B42318", fontSize: 13, fontFamily: FONT_MONO,
  },

  cardWrap: { marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, position: "relative", zIndex: 2 },

  exportStage: {
    width: "min(720px, 96vw)",
    padding: "44px 18px",
    borderRadius: 28,
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    background: "transparent",
  },
  exportAmbient: {
    position: "absolute", inset: 0, pointerEvents: "none",
    background:
      "radial-gradient(780px 520px at 50% 60%,rgba(255,184,0,.42),transparent 60%)," +
      "radial-gradient(900px 620px at 70% 65%,rgba(255,214,122,.22),transparent 65%)," +
      "radial-gradient(900px 700px at 35% 68%,rgba(123,47,255,.14),transparent 68%)," +
      "radial-gradient(1200px 900px at 50% 10%,rgba(255,255,255,.88),rgba(247,245,255,.96) 60%)",
  },

  cardOuter: { width: "min(420px, 92vw)", borderRadius: 28, position: "relative", padding: 18 },
  outerGlow: {
    position: "absolute", inset: -10, borderRadius: 34,
    background: "radial-gradient(closest-side,rgba(255,184,0,.30),transparent 65%),radial-gradient(closest-side,rgba(255,214,122,.16),transparent 65%)",
    filter: "blur(12px)", opacity: .95, zIndex: 0, pointerEvents: "none",
  },
  frameOuter: {
    position: "absolute", inset: 0, borderRadius: 28,
    background: "linear-gradient(135deg,#FFF2C7 0%,#FFB800 40%,#FFD76A 70%,#FFF2C7 100%)",
    boxShadow: "0 18px 70px rgba(255,184,0,.22)", zIndex: 1,
  },
  frameInner: {
    position: "absolute", inset: 10, borderRadius: 20, zIndex: 2,
    background:
      "linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.03))," +
      "repeating-linear-gradient(90deg,rgba(0,0,0,.06) 0 1px,transparent 1px 16px)",
    clipPath: "polygon(22px 0,calc(100% - 22px) 0,100% 22px,100% calc(100% - 22px),calc(100% - 22px) 100%,22px 100%,0 calc(100% - 22px),0 22px)",
    border: "1px solid rgba(0,0,0,.16)",
  },
  cornerSpark: { position: "absolute", zIndex: 6, fontSize: 12, color: "rgba(26,10,0,.45)", textShadow: "0 1px 0 rgba(255,255,255,.75)", userSelect: "none" },

  card: {
    position: "relative", zIndex: 5, borderRadius: 18, overflow: "hidden",
    background: "linear-gradient(180deg,#1B1B1F 0%,#111114 100%)",
    border: "1px solid rgba(0,0,0,.35)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)",
  },
  cardHeader: {
    padding: "12px 14px", position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg,rgba(255,184,0,.14),rgba(123,47,255,.10))",
    borderBottom: "1px solid rgba(255,255,255,.08)",
  },
  cardHeaderCenter: { display: "flex", alignItems: "center", gap: 10 },
  cardLogoImg:      { width: 28, height: 28, objectFit: "contain" },
  ritualLogoText:   { fontWeight: 800, letterSpacing: 2.8, fontSize: 14, color: "rgba(255,184,0,.95)", fontFamily: FONT_TECH },
  badge: {
    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
    fontSize: 10, border: "1px solid rgba(255,255,255,.18)", borderRadius: 999,
    padding: "4px 10px", fontWeight: 600, letterSpacing: .8,
    background: "rgba(0,0,0,.25)", fontFamily: FONT_MONO,
  },
  cardName: {
    padding: "14px 14px 12px", textAlign: "center", fontWeight: 800, fontSize: 22,
    letterSpacing: .6, color: "rgba(230,240,255,.95)",
    borderBottom: "1px solid rgba(255,255,255,.08)", fontFamily: FONT_TECH,
  },
  avatarSection: {
    padding: "14px 14px 16px", position: "relative", display: "flex",
    justifyContent: "center", borderBottom: "1px solid rgba(255,255,255,.08)",
  },
  avatarScreen: {
    padding: 10, borderRadius: 16,
    background: "linear-gradient(135deg,rgba(255,184,0,.12),rgba(255,255,255,.05))",
    border: "1px solid rgba(255,184,0,.22)",
  },
  avatarFrame: {
    width: 190, height: 190, borderRadius: 12, overflow: "hidden",
    border: "2px solid rgba(255,255,255,.12)",
    background: "linear-gradient(135deg,rgba(255,255,255,.08),rgba(0,0,0,.08))",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  avatarImg:         { width: "100%", height: "100%", objectFit: "cover" },
  avatarPlaceholder: { fontSize: 56, color: "rgba(255,255,255,.90)" },
  sideHandle: {
    position: "absolute", right: 8, top: "50%",
    transform: "translateY(-50%) rotate(90deg)",
    fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 2.2,
    color: "rgba(255,184,0,.45)", whiteSpace: "nowrap",
  },

  cardBody: {
    padding: "14px 14px 16px",
    background: "linear-gradient(180deg,rgba(255,255,255,.96),rgba(255,255,255,.92))",
    color: LIGHT.text,
  },
  starsRow:     { display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 },
  roleLabelRow: { display: "flex", justifyContent: "center", marginBottom: 12 },
  roleLabel: {
    border: "1px solid", borderRadius: 999, padding: "7px 16px",
    fontWeight: 800, letterSpacing: 3.2, fontSize: 11,
    background: "rgba(255,255,255,.75)", fontFamily: FONT_TECH,
  },
  statsRowSingle: { display: "flex", justifyContent: "center", marginBottom: 12 },
  statItem:       { textAlign: "center", minWidth: 160 },
  statVal:        { fontWeight: 800, fontSize: 22, color: LIGHT.purple, fontFamily: FONT_TECH, letterSpacing: .6 },
  statLbl:        { fontSize: 10, letterSpacing: 2.2, color: LIGHT.muted, fontWeight: 700, fontFamily: FONT_MONO },
  divider:        { height: 1, background: "linear-gradient(90deg,transparent,rgba(0,0,0,.14),transparent)", margin: "12px 0" },
  sloganBox: {
    background: "rgba(123,47,255,.05)", border: "1px solid rgba(123,47,255,.12)",
    borderRadius: 14, padding: "12px 12px", textAlign: "center",
  },
  ritualModeLabel: { fontWeight: 800, color: LIGHT.purple, letterSpacing: 1.0, fontSize: 10, marginBottom: 6, fontFamily: FONT_TECH },
  bioText:         { color: "rgba(26,10,0,.72)", fontStyle: "italic", fontWeight: 600, fontSize: 13, lineHeight: 1.35, fontFamily: FONT_SANS },

  cardFooter: {
    padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
    borderTop: "1px solid rgba(255,255,255,.08)",
    background: "linear-gradient(135deg,rgba(0,0,0,.35),rgba(123,47,255,.10))",
  },
  footerLabel: { color: "rgba(255,184,0,.55)", fontWeight: 800, letterSpacing: 1.6, fontSize: 10, fontFamily: FONT_TECH },
  footerDot:   { width: 7, height: 7, borderRadius: 999, background: LIGHT.pink, boxShadow: "0 0 12px rgba(255,47,154,.25)" },

  actions: { display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" },
  downloadBtn: {
    padding: "12px 22px", borderRadius: 12,
    border: "none",
    background: `linear-gradient(135deg, ${LIGHT.purple}, ${LIGHT.pink})`,
    color: "white",
    fontWeight: 800, letterSpacing: .3,
    boxShadow: "0 12px 28px rgba(123,47,255,.25)",
    fontFamily: FONT_TECH, fontSize: 14,
    minWidth: 180, textAlign: "center",
  },
  secondaryBtn: {
    padding: "12px 18px", borderRadius: 12,
    border: "1px solid rgba(0,0,0,.10)",
    background: "transparent", color: LIGHT.muted,
    fontWeight: 800, cursor: "pointer", fontFamily: FONT_SANS,
  },
  hint: {
    maxWidth: 480, textAlign: "center", fontSize: 12,
    color: LIGHT.muted, fontFamily: FONT_MONO, lineHeight: 1.45,
    padding: "8px 12px",
    background: "rgba(123,47,255,.06)",
    border: "1px solid rgba(123,47,255,.12)",
    borderRadius: 10,
  },
};