(function () {
  const sections = [
    {
      title: "Create",
      items: [
        {
          id: "create",
          label: "Create",
          icon: "add_link",
          href: "index.html"
        }
      ]
    },
    {
      title: "Explore",
      items: [
        {
          id: "discover",
          label: "Discover",
          icon: "explore",
          locked: true
        },
        {
          id: "trackings",
          label: "Trackings",
          icon: "insights",
          locked: true
        }
      ]
    },
    {
      title: "Account",
      items: [
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
    const classes = ["nav-link", isActive ? "is-active" : "", item.locked ? "is-locked" : ""]
      .filter(Boolean)
      .join(" ");
    const content = `${icon(item.icon, "nav-icon")}<span>${item.label}</span>${
      item.locked ? icon("lock", "lock-icon") : ""
    }`;

    if (item.locked) {
      return `
        <button
          class="${classes}"
          type="button"
          data-unavailable="${item.label}"
          aria-disabled="true"
          aria-describedby="sidebarUnavailableStatus"
        >
          ${content}
          <span class="sr-only">Not available yet</span>
        </button>
      `;
    }

    return `
      <a class="${classes}" href="${item.href}"${isActive ? ' aria-current="page"' : ""}>
        ${content}
      </a>
    `;
  }

  function renderSection(section, activeId) {
    const sectionId = `nav-${section.title.toLowerCase()}`;
    return `
      <section class="nav-section" aria-labelledby="${sectionId}">
        <h2 class="nav-title" id="${sectionId}">${section.title}</h2>
        <div class="nav-items">
          ${section.items.map((item) => renderItem(item, activeId)).join("")}
        </div>
      </section>
    `;
  }

  function renderSidebar(sidebar) {
    const activeId = sidebar.dataset.sidebarActive || "create";
    sidebar.innerHTML = `
      <nav class="nav" aria-label="Primary">
        ${sections.map((section) => renderSection(section, activeId)).join("")}
      </nav>

      <p class="sr-only" id="sidebarUnavailableStatus" role="status" aria-live="polite">
        Locked destinations are not available yet.
      </p>

      <section class="sidebar-signup">
        <p class="signup-title">Love it?</p>
        <button class="signup-pill" type="button" data-signup-preview>Sign Up</button>
        <p class="signup-copy">Make Yours, It's Free</p>
      </section>
    `;

    const status = sidebar.querySelector("#sidebarUnavailableStatus");
    sidebar.querySelectorAll("[data-unavailable]").forEach((button) => {
      button.addEventListener("click", () => {
        status.textContent = `${button.dataset.unavailable} is not available yet.`;
      });
    });

    sidebar.querySelector("[data-signup-preview]")?.addEventListener("click", () => {
      status.textContent = "Sign Up is not connected during Prototype Cleanup.";
    });
  }

  document.querySelectorAll("[data-openme-sidebar]").forEach(renderSidebar);
})();
