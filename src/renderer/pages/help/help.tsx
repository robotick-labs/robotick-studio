// src/renderer/pages/help/help.tsx

import React from "react";

export default function HelpPage() {
  return (
    <div className="help-page">
      <header className="help-hero">
        <p className="eyebrow">Support</p>
        <h1>Robotick Hub Help Center</h1>
        <p>Coming soon.</p>
      </header>

      <section className="help-cards">
        <article className="help-card">
          <h3>Getting Started</h3>
          <p>Coming soon.</p>
        </article>
        <article className="help-card">
          <h3>Remote Operations</h3>
          <p>Coming soon.</p>
        </article>
        <article className="help-card">
          <h3>Need Assistance?</h3>
          <p>Coming soon.</p>
        </article>
      </section>

      <section className="help-section">
        <div>
          <h2>Checklist</h2>
          <p>Coming soon.</p>
        </div>
        <div>
          <h2>Diagnostics</h2>
          <p>Coming soon.</p>
        </div>
      </section>
    </div>
  );
}
