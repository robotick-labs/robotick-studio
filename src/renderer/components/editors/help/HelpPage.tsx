// src/renderer/components/editors/help/help.tsx

import React from "react";
import styles from "./styles/HelpPage.module.css";

export default function HelpPage() {
  return (
    <div className={styles.helpPage}>
      <header className={styles.helpHero}>
        <p className={styles.eyebrow}>Support</p>
        <h1>Robotick Hub Help Center</h1>
        <p>Coming soon.</p>
      </header>

      <section className={styles.helpCards}>
        <article className={styles.helpCard}>
          <h3>Getting Started</h3>
          <p>Coming soon.</p>
        </article>
        <article className={styles.helpCard}>
          <h3>Remote Operations</h3>
          <p>Coming soon.</p>
        </article>
        <article className={styles.helpCard}>
          <h3>Need Assistance?</h3>
          <p>Coming soon.</p>
        </article>
      </section>

      <section className={styles.helpSection}>
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
