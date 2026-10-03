(function () {
  const sections = [
    {
      title: "About",
      items: [
        {
          id: "discover",
          label: "Discover",
          icon: "explore",
          href: "discover.html"
        }
      ]
    },
    {
      title: "Our Product",
      items: [
        {
          id: "op4n-me",
          label: "op4n.me",
          icon: "badge",
          href: "index.html"
        },
      ]
    },
    {
      title: "Tools",
      items: [
        {
          id: "trackings",
          label: "Trackings",
          icon: "insights",
          locked: true
        },
        {
          id: "settings",
          label: "Setting",
          icon: "settings",
          locked: true
        }
      ]
    }
  ];

  function icon(name, className) {
    return `<span class="material-symbols-outlined ${className}" aria-hidden="true">${name}</span>`;
  }

  function renderItem(item, activeId) {
    const isActive = item.id === activeId;
    const className = ["nav-link", isActive ? "is-active" : "", item.locked ? "is-locked" : ""]
      .filter(Boolean)
      .join(" ");
    const content = `${icon(item.icon, "nav-icon")}${item.label}${item.locked ? icon("lock", "lock-icon") : ""}`;

    if (item.href) {
      return `<a class="${className}" href="${item.href}"${isActive ? ' aria-current="page"' : ""}>${content}</a>`;
    }

    return `<button class="${className}" type="button">${content}</button>`;
  }

  function renderSection(section, activeId) {
    const items = section.items.map((item) => renderItem(item, activeId)).join("");

    return `
      <div class="nav-section">
        <button class="nav-title" type="button">${section.title}</button>
        <div class="nav-items">${items}</div>
      </div>
    `;
  }

  function renderSidebar(sidebar) {
    const activeId = sidebar.dataset.sidebarActive || "";
    sidebar.innerHTML = `
      <nav class="nav">
        ${sections.map((section) => renderSection(section, activeId)).join("")}
      </nav>

      <section class="sidebar-signup">
        <p class="signup-title">Love it?</p>
        <button class="signup-pill" type="button">Sign Up</button>
        <p class="signup-copy">Make Yours, It's Free</p>
      </section>
    `;
  }

  document.querySelectorAll("[data-openme-sidebar]").forEach(renderSidebar);
})();
