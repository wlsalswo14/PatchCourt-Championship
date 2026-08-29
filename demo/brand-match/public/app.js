const variant = location.pathname.startsWith("/candidate")
  ? "candidate"
  : "incumbent";

document.body.dataset.variant = variant;

const state = {
  signedIn: false,
  screen: "login",
  query: "",
  offerOpen: false,
  draftReady: false,
  data: null
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  const paths = {
    mark: '<path d="M5 16.2 10.2 21 23 7.8"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]}</svg>`;
}

function shell(content) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <button class="wordmark" type="button" data-action="home" aria-label="Creator Match home">
          <span class="wordmark-mark">CM</span>
          <span>Creator Match</span>
        </button>
        <div class="topbar-meta">
          <span class="fixture-pill">Owned demo</span>
          ${state.signedIn ? '<span class="account">Northstar Goods</span>' : ""}
        </div>
      </header>
      ${
        state.signedIn
          ? `<nav class="nav" aria-label="Primary navigation">
              <button type="button" data-action="home" ${state.screen === "home" ? 'aria-current="page"' : ""}>Overview</button>
              <button type="button" data-action="directory" ${["directory", "profile"].includes(state.screen) ? 'aria-current="page"' : ""}>Creator Directory</button>
            </nav>`
          : ""
      }
      <main id="main">${content}</main>
      <footer>This fixture has no email, payment, webhook, or external API side effect.</footer>
    </div>`;
}

function renderLogin() {
  app.innerHTML = shell(`
    <section class="login-screen" aria-labelledby="login-title">
      <div class="login-copy">
        <p class="eyebrow">Creator partnerships, without the guesswork</p>
        <h1 id="login-title">Find the creator who already fits your market.</h1>
        <p>Use the project-owned brand account to inspect a deterministic creator profile and prepare a local offer draft.</p>
      </div>
      <div class="login-card">
        <div class="avatar-brand" aria-hidden="true">NG</div>
        <div>
          <span class="label">Demo workspace</span>
          <strong>Northstar Goods</strong>
        </div>
        <button class="primary" type="button" data-action="login" data-testid="demo-login">Continue as brand demo</button>
        <p class="microcopy">No password or real credential is used.</p>
      </div>
    </section>`);
}

function renderHome() {
  app.innerHTML = shell(`
    <section class="home-screen">
      <p class="eyebrow">Brand workspace</p>
      <h1 data-testid="home-heading">Good evening, Northstar.</h1>
      <p class="lead">Start with the market, then inspect the evidence before you make an offer.</p>
      <button class="directory-cta" type="button" data-action="directory" data-testid="open-directory">
        <span class="cta-icon">${icon("users")}</span>
        <span><strong>Open Creator Directory</strong><small>Search creators by market and category</small></span>
        ${icon("arrow")}
      </button>
    </section>`);
}

function creatorResult() {
  const creator = state.data.creator;
  return `
    <article class="creator-result" data-testid="creator-result">
      <img src="/assets/avatar.svg" alt="" />
      <div class="creator-result-main">
        <div class="result-heading">
          <div><h2>${escapeHtml(creator.name)}</h2><p>${escapeHtml(creator.handle)}</p></div>
          <span class="market-tag">${escapeHtml(creator.market)}</span>
        </div>
        <p class="result-category">${escapeHtml(creator.category)}</p>
        <div class="result-stats">
          <span data-testid="followers">${escapeHtml(creator.followers)}</span>
          <span>${escapeHtml(creator.engagement)}</span>
        </div>
      </div>
      <button class="secondary view-profile" type="button" data-action="profile" data-testid="open-john-smith" aria-label="Open John Smith profile">View profile</button>
    </article>`;
}

function renderDirectory() {
  const hasResult = state.query.trim().toUpperCase() === "US";
  app.innerHTML = shell(`
    <section class="directory-screen" aria-labelledby="directory-title">
      <div class="section-heading">
        <div><p class="eyebrow">Discovery</p><h1 id="directory-title">Creator Directory</h1></div>
        <p>Search by a market signal to find a relevant creator.</p>
      </div>
      <form class="search-form" data-form="search" role="search">
        <label for="creator-search">Market or creator</label>
        <div class="search-control">${icon("search")}<input id="creator-search" name="query" data-testid="creator-search" autocomplete="off" value="${escapeHtml(state.query)}" placeholder="Try US" /><button type="submit" data-testid="search-submit">Search</button></div>
      </form>
      <div class="results-meta" aria-live="polite">
        ${hasResult ? '<strong>1 creator</strong><span>matching “US”</span>' : '<strong>Start a search</strong><span>Use the fixed task market: US</span>'}
      </div>
      <div class="results">${hasResult ? creatorResult() : ""}</div>
    </section>`);
  document.querySelector("#creator-search")?.focus();
}

function evidenceCard(key, label, value, detail = "") {
  return `
    <article class="evidence-card" data-evidence-key="${key}">
      <span class="evidence-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    </article>`;
}

function offerPanel() {
  if (!state.offerOpen) return "";
  return `
    <section class="offer-panel" aria-labelledby="offer-title" data-testid="offer-panel">
      <div class="offer-heading"><div><span class="label">Local draft</span><h2 id="offer-title">Prepare an offer</h2></div><button class="icon-button" type="button" data-action="close-offer" aria-label="Close offer composer">×</button></div>
      <label for="offer-message">Message</label>
      <textarea id="offer-message" data-testid="offer-message" rows="4">${escapeHtml(state.data.offer.message)}</textarea>
      <label for="offer-amount">Fee (USD)</label>
      <div class="amount-field"><span>$</span><input id="offer-amount" data-testid="offer-amount" inputmode="numeric" value="${escapeHtml(state.data.offer.amount)}" /></div>
      <button class="primary prepare-offer" type="button" data-action="prepare-offer" data-testid="prepare-offer">Prepare draft — do not send</button>
      ${
        state.draftReady
          ? `<div class="draft-status" role="status" tabindex="-1" data-testid="draft-status">${icon("check")}<div><strong>Draft ready — not sent</strong><span>Fee saved as $${escapeHtml(state.data.offer.amount)}. No external action occurred.</span></div></div>`
          : '<p class="microcopy">This action stores state in this browser screen only.</p>'
      }
    </section>`;
}

function renderProfile() {
  const creator = state.data.creator;
  const trust = state.data.trust;
  app.innerHTML = shell(`
    <section class="profile-screen" aria-labelledby="profile-title">
      <button class="back-button" type="button" data-action="directory">← Back to US results</button>
      <div class="profile-layout">
        <div class="profile-main">
          <header class="profile-hero">
            <img src="/assets/avatar.svg" alt="" />
            <div><div class="hero-meta"><span class="market-tag">${escapeHtml(creator.market)}</span><span>${escapeHtml(creator.category)}</span></div><h1 id="profile-title" data-testid="profile-heading">${escapeHtml(creator.name)}</h1><p>${escapeHtml(creator.handle)} · ${escapeHtml(creator.followers)}</p></div>
          </header>
          <section class="trust-section" aria-labelledby="trust-title">
            <div class="trust-heading"><div><p class="eyebrow">Decision evidence</p><h2 id="trust-title">Is this creator a fit?</h2></div>${variant === "candidate" ? '<span class="verified-badge">Evidence checked</span>' : ""}</div>
            <div class="evidence-grid">
              ${evidenceCard("audience", "Audience", trust.audience, trust.audienceDetail)}
              ${evidenceCard("channel", "Verified channel", trust.channel, trust.channelDetail)}
              ${evidenceCard("market-fit", "US market fit", trust.marketFit, trust.marketFitDetail)}
              ${evidenceCard("next-action", "Next action", trust.nextAction, trust.nextActionDetail)}
            </div>
            ${
              trust.providerDebug
                ? `<div class="provider-debug" data-testid="provider-debug"><span>Connected provider</span><code>${escapeHtml(trust.providerDebug)}</code></div>`
                : ""
            }
          </section>
        </div>
        <aside class="offer-summary">
          <span class="label">Recommended next step</span>
          <h2>${escapeHtml(trust.offerHeading)}</h2>
          <p>${escapeHtml(trust.offerRationale)}</p>
          <button class="primary offer-button" type="button" data-action="open-offer" data-testid="open-offer">Review offer draft</button>
          <span class="safety-note">Nothing is sent without a separate authenticated product action.</span>
        </aside>
      </div>
      ${offerPanel()}
    </section>`);
}

function render() {
  if (!state.data) return;
  if (state.screen === "login") return renderLogin();
  if (state.screen === "home") return renderHome();
  if (state.screen === "directory") return renderDirectory();
  return renderProfile();
}

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  let focusAfterRender = null;
  if (action === "login") {
    state.signedIn = true;
    state.screen = "home";
  } else if (action === "home") {
    state.screen = state.signedIn ? "home" : "login";
  } else if (action === "directory") {
    state.screen = "directory";
  } else if (action === "profile") {
    state.screen = "profile";
  } else if (action === "open-offer") {
    state.offerOpen = true;
  } else if (action === "close-offer") {
    state.offerOpen = false;
    state.draftReady = false;
  } else if (action === "prepare-offer") {
    const amount = document.querySelector("#offer-amount");
    const message = document.querySelector("#offer-message");
    state.data.offer.amount = amount.value;
    state.data.offer.message = message.value;
    state.draftReady = true;
    focusAfterRender = "[data-testid='draft-status']";
  }
  render();
  if (focusAfterRender) {
    requestAnimationFrame(() => document.querySelector(focusAfterRender)?.focus());
  }
});

app.addEventListener("submit", (event) => {
  if (!event.target.matches('[data-form="search"]')) return;
  event.preventDefault();
  state.query = new FormData(event.target).get("query") ?? "";
  render();
});

fetch(`/__patchcourt/data.json?variant=${variant}`)
  .then((response) => {
    if (!response.ok) throw new Error(`Fixture data failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    state.data = data;
    render();
  })
  .catch(() => {
    app.innerHTML = '<main id="main"><h1>Fixture unavailable</h1><p>Local demo data could not be loaded.</p></main>';
  });
