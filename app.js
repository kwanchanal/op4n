const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const STORAGE_PREFIX = "openme";
const LEGACY_STORAGE_PREFIX = "wemint";

function storageKey(name) {
  return `${STORAGE_PREFIX}_${name}`;
}

function legacyStorageKey(name) {
  return `${LEGACY_STORAGE_PREFIX}_${name}`;
}

function getStorageValue(name, fallback) {
  const key = storageKey(name);
  const legacyKey = legacyStorageKey(name);
  const value = storage.get(key, undefined);
  if (value !== undefined) return value;
  const legacyValue = storage.get(legacyKey, undefined);
  if (legacyValue !== undefined) {
    storage.set(key, legacyValue);
    return legacyValue;
  }
  return fallback;
}

function setStorageValue(name, value) {
  storage.set(storageKey(name), value);
}

function getRawStorageValue(name) {
  const key = storageKey(name);
  const legacyKey = legacyStorageKey(name);
  const value = localStorage.getItem(key);
  if (value !== null) return value;
  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    localStorage.setItem(key, legacyValue);
  }
  return legacyValue;
}

const defaultProfile = {
  name: "Kwanchanal Grographic",
  username: "yours",
  bio: "Retired designer turned FinTech Product Manager, Mostly underwater",
};

const REQUIRED_DEFAULT_LINKS = [
  {
    id: "default-portfolio",
    title: "Portfolio",
    hasUrl: true,
    url: "https://kwanchanal.github.io/hello/",
    shortCode: "PL2TSH5",
    thumbnail: "",
    featured: false,
    enabled: false,
    locked: true,
  },
  {
    id: "default-art-collection",
    title: "Art Collection",
    hasUrl: true,
    url: "https://kwanchanal.github.io/mintable-collection/",
    shortCode: "49BJ5U",
    thumbnail: "",
    featured: false,
    enabled: false,
    locked: true,
  },
];
const REQUIRED_DEFAULT_LINK_IDS = new Set(REQUIRED_DEFAULT_LINKS.map((link) => link.id));
const defaultLinks = REQUIRED_DEFAULT_LINKS.map((link) => ({ ...link }));
const DEFAULT_PORTFOLIO_THUMBNAIL = "";
const retiredMockLinkTitles = new Set([
  "dribbble",
]);
const retiredAssetPaths = new Set([
  "mockup/featured-portfolio.png",
  "mockup/banner-1.png",
  "mockup/banner-2.png",
  "mockup/banner-3.png",
  "mockup/background.png",
]);

function sanitizeRetiredAssetPath(value) {
  const normalized = String(value || "").trim();
  return retiredAssetPaths.has(normalized) ? "" : normalized;
}

const FORCE_PROFILE_MOCK = false;
const FORCE_APPEARANCE_MOCK = true;
const profile = FORCE_PROFILE_MOCK ? { ...defaultProfile } : getStorageValue("profile", defaultProfile);
const savedLinks = getStorageValue("links", defaultLinks);
const links = Array.isArray(savedLinks)
  ? savedLinks.filter((link) => {
      if (REQUIRED_DEFAULT_LINK_IDS.has(link?.id)) return true;
      return !retiredMockLinkTitles.has(String(link?.title || "").trim().toLowerCase());
    })
  : defaultLinks;
const socialLinks = getStorageValue("social_links", {});
const savedLinkEnabledOverrides = getStorageValue("link_enabled_overrides", {});
const linkEnabledOverrides = savedLinkEnabledOverrides
  && typeof savedLinkEnabledOverrides === "object"
  && !Array.isArray(savedLinkEnabledOverrides)
  ? savedLinkEnabledOverrides
  : {};
let activeLinkFilter = getStorageValue(
  "link_filter",
  "example"
);
if (!["created", "example"].includes(activeLinkFilter)) {
  activeLinkFilter = "example";
}

function getLinkEnabled(link) {
  const id = String(link?.id || "");
  if (REQUIRED_DEFAULT_LINK_IDS.has(id)) {
    return false;
  }
  if (id && Object.prototype.hasOwnProperty.call(linkEnabledOverrides, id)) {
    return Boolean(linkEnabledOverrides[id]);
  }
  return typeof link?.enabled === "boolean" ? link.enabled : true;
}

function setLinkEnabled(link, enabled) {
  if (REQUIRED_DEFAULT_LINK_IDS.has(link?.id)) {
    link.enabled = false;
    if (link?.id) {
      linkEnabledOverrides[link.id] = false;
    }
    return;
  }
  const nextEnabled = Boolean(enabled);
  link.enabled = nextEnabled;
  if (link?.id) {
    linkEnabledOverrides[link.id] = nextEnabled;
  }
}

function getLinkFilterType(link) {
  return REQUIRED_DEFAULT_LINK_IDS.has(link?.id) ? "example" : "created";
}

function ensureRequiredDefaultLinks() {
  if (!Array.isArray(links)) return;
  let didChange = false;
  REQUIRED_DEFAULT_LINKS.forEach((requiredLink, targetIndex) => {
    const requiredTitle = requiredLink.title.trim().toLowerCase();
    const requiredUrl = requiredLink.url.trim().toLowerCase();
    const requiredShortCode = requiredLink.shortCode.trim().toLowerCase();
    const existingIndex = links.findIndex((link) => {
      const title = String(link?.title || "").trim().toLowerCase();
      const url = String(link?.url || "").trim().toLowerCase();
      const shortCode = String(link?.shortCode || "").trim().toLowerCase();
      return link?.id === requiredLink.id
        || title === requiredTitle
        || url === requiredUrl
        || shortCode === requiredShortCode;
    });
    if (existingIndex >= 0) {
      const [existingLink] = links.splice(existingIndex, 1);
      const nextLink = {
        ...existingLink,
        ...requiredLink,
        enabled: REQUIRED_DEFAULT_LINK_IDS.has(requiredLink.id) ? false : getLinkEnabled(existingLink),
      };
      delete nextLink.alwaysEnabled;
      links.splice(targetIndex, 0, nextLink);
      didChange = didChange
        || existingIndex !== targetIndex
        || Boolean(existingLink.alwaysEnabled)
        || Object.entries(requiredLink).some(([key, value]) => {
          if (key === "enabled") return false;
          return existingLink[key] !== value;
        });
      return;
    }
    links.splice(targetIndex, 0, { ...requiredLink });
    didChange = true;
  });
  for (let index = links.length - 1; index >= REQUIRED_DEFAULT_LINKS.length; index -= 1) {
    const link = links[index];
    const duplicateDefaultLink = REQUIRED_DEFAULT_LINKS.some((requiredLink) => {
      const title = String(link?.title || "").trim().toLowerCase();
      const url = String(link?.url || "").trim().toLowerCase();
      const shortCode = String(link?.shortCode || "").trim().toLowerCase();
      return link?.id === requiredLink.id
        || title === requiredLink.title.trim().toLowerCase()
        || url === requiredLink.url.trim().toLowerCase()
        || shortCode === requiredLink.shortCode.trim().toLowerCase();
    });
    if (duplicateDefaultLink) {
      links.splice(index, 1);
      didChange = true;
    }
  }
  if (didChange) {
    setStorageValue("links", links);
  }
}

ensureRequiredDefaultLinks();

if (Array.isArray(links)) {
  const existingCodes = new Set();
  let didNormalizeLinks = savedLinks.length !== links.length;
  links.forEach((link) => {
    if (REQUIRED_DEFAULT_LINK_IDS.has(link?.id)) {
      if (link.alwaysEnabled !== undefined) {
        delete link.alwaysEnabled;
        didNormalizeLinks = true;
      }
      if (typeof link.enabled !== "boolean") {
        link.enabled = false;
        didNormalizeLinks = true;
      }
      if (link.enabled !== false) {
        link.enabled = false;
        linkEnabledOverrides[link.id] = false;
        didNormalizeLinks = true;
      }
    }
    const nextUrl = String(link?.url || "").trim();
    const nextHasUrl = typeof link?.hasUrl === "boolean" ? link.hasUrl : Boolean(nextUrl);
    if (link.url !== (nextHasUrl ? nextUrl : "") || link.hasUrl !== nextHasUrl) {
      didNormalizeLinks = true;
    }
    link.url = nextHasUrl ? nextUrl : "";
    link.hasUrl = nextHasUrl;
    const nextThumbnail = sanitizeRetiredAssetPath(link?.thumbnail);
    if (link.thumbnail !== nextThumbnail) {
      didNormalizeLinks = true;
    }
    link.thumbnail = nextThumbnail;
    if (String(link.shortCode || "").trim()) {
      existingCodes.add(String(link.shortCode).trim());
    }
  });
  links.forEach((link) => {
    const previousShortCode = link.shortCode;
    ensureShortCode(link, existingCodes);
    if (link.shortCode !== previousShortCode) {
      didNormalizeLinks = true;
    }
  });
  if (didNormalizeLinks) {
    setStorageValue("links", links);
  }
}

// Keep existing user data, but backfill a portfolio thumbnail only when a valid default exists.
if (Array.isArray(links)) {
  const portfolioLink = links.find((link) => (link?.title || "").trim().toLowerCase() === "portfolio");
  if (portfolioLink && DEFAULT_PORTFOLIO_THUMBNAIL && !String(portfolioLink.thumbnail || "").trim()) {
    portfolioLink.thumbnail = DEFAULT_PORTFOLIO_THUMBNAIL;
    portfolioLink.featured = true;
    setStorageValue("links", links);
  }
}
let inboxName = getStorageValue("inbox_name", "Get in touch");
const rawInboxPosition = getRawStorageValue("inbox_position");
const rawBannerPosition = getRawStorageValue("banner_position");
let inboxPosition = Number(rawInboxPosition ?? links.length + 1);
let bannerPosition = Number(rawBannerPosition ?? links.length);
if (Number.isNaN(inboxPosition)) inboxPosition = links.length + 1;
if (Number.isNaN(bannerPosition)) bannerPosition = links.length;
let inboxLayout = getStorageValue("inbox_layout", {
  type: "banner",
  thumbnail: "",
});
if (typeof inboxLayout.featured === "boolean") {
  inboxLayout = {
    type: inboxLayout.featured ? "banner" : "classic",
    thumbnail: inboxLayout.thumbnail || "",
  };
}
const defaultInboxFields = [
  { id: "inbox-name", label: "Name", required: false, type: "text" },
  { id: "inbox-email", label: "Email address", required: true, type: "email" },
  { id: "inbox-phone", label: "Phone number", required: true, type: "tel" },
  { id: "inbox-booking", label: "Booking Date", required: true, type: "date" },
];
let inboxFormFields = getStorageValue("inbox_fields", defaultInboxFields);
if (!Array.isArray(inboxFormFields) || inboxFormFields.length === 0) {
  inboxFormFields = [...defaultInboxFields];
}
const defaultBannerItems = [];
const savedBannerItems = getStorageValue("banner_items", null);
let bannerItems = Array.isArray(savedBannerItems) && savedBannerItems.length
  ? savedBannerItems
  : defaultBannerItems;
if (!Array.isArray(bannerItems) || !bannerItems.length) {
  bannerItems = [...defaultBannerItems];
}
bannerItems = bannerItems
  .map((item) => {
    const nextUrl = String(item?.url || "").trim();
    const nextHasLink = typeof item?.hasLink === "boolean" ? item.hasLink : Boolean(nextUrl);
    return {
      id: item?.id || crypto.randomUUID(),
      image: sanitizeRetiredAssetPath(item?.image),
      hasLink: nextHasLink,
      url: nextHasLink ? nextUrl : "",
      showPrice: Boolean(item?.showPrice),
      price: String(item?.price || ""),
      unit: String(item?.unit || ""),
    };
  })
  .filter((item) => item.image && (!item.hasLink || item.url));
if (!bannerItems.length) {
  bannerItems = [...defaultBannerItems];
}
let bannerEnabled = Boolean(getStorageValue("banner_enabled", true));
if (bannerItems.length < 3) {
  bannerEnabled = false;
}
const defaultAppearance = {
  profileImageUrl: "",
  backgroundImageUrl: "",
  backgroundColor: "#ffffff",
  buttonColor: "#000000",
  profileFontColor: "#111827",
  buttonFontColor: "#f9fafb",
};
const appearance = FORCE_APPEARANCE_MOCK
  ? { ...defaultAppearance }
  : getStorageValue("appearance", defaultAppearance);
appearance.backgroundImageUrl = sanitizeRetiredAssetPath(appearance.backgroundImageUrl);
const visibility = getStorageValue("visibility", {
  showProfileImage: true,
  showDisplayName: true,
  showBio: true,
  showSocialIcons: true,
});

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function prettyFieldType(type) {
  const map = {
    text: "Short answer",
    textarea: "Paragraph",
    single_choice: "Single choice",
    checkboxes: "Checkboxes",
    dropdown: "Dropdown",
    date: "Date",
    email: "Email",
    tel: "Phone",
  };
  return map[type] || "Short answer";
}

function createShortCode(length = 7) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

function ensureShortCode(link, existingCodes = new Set()) {
  if (!link) return "";
  let nextCode = String(link.shortCode || "").trim();
  if (nextCode) {
    existingCodes.add(nextCode);
    return nextCode;
  }
  do {
    nextCode = createShortCode();
  } while (existingCodes.has(nextCode));
  existingCodes.add(nextCode);
  link.shortCode = nextCode;
  return nextCode;
}

function getShortLink(link) {
  const code = String(link.shortCode || "").trim();
  return code ? `https://op4n.me/${escapeHTML(code)}` : "";
}

function isChoiceType(type) {
  return type === "single_choice" || type === "checkboxes" || type === "dropdown";
}

function normalizeChoices(choices) {
  if (!Array.isArray(choices)) return [];
  return choices
    .map((choice) => String(choice || "").trim())
    .filter(Boolean);
}

inboxFormFields = inboxFormFields.map((field) => {
  const nextType = field?.type || "text";
  return {
    id: field?.id || crypto.randomUUID(),
    label: String(field?.label || "Untitled"),
    required: Boolean(field?.required),
    type: nextType,
    choices: isChoiceType(nextType) ? normalizeChoices(field?.choices) : [],
  };
});

const elements = {
  appShell: document.getElementById("appShell"),
  adPanel: document.getElementById("adPanel"),
  adPanelClose: document.getElementById("adPanelClose"),
  adYouWord: document.getElementById("adYouWord"),
  adContactTrigger: document.getElementById("adContactTrigger"),
  adContactBackdrop: document.getElementById("adContactBackdrop"),
  adContactSheet: document.getElementById("adContactSheet"),
  adContactClose: document.getElementById("adContactClose"),
  adContactForm: document.getElementById("adContactForm"),
  adContactEmail: document.getElementById("adContactEmail"),
  adContactMessage: document.getElementById("adContactMessage"),
  adContactNote: document.getElementById("adContactNote"),
  linksList: document.getElementById("linksList"),
  previewLinks: document.getElementById("previewLinks"),
  previewName: document.getElementById("previewName"),
  profileName: document.getElementById("profileName"),
  profileMeta: document.getElementById("profileMeta"),
  previewBio: document.getElementById("previewBio"),
  profileSocialIcons: document.getElementById("profileSocialIcons"),
  previewSocialIcons: document.getElementById("previewSocialIcons"),
  previewLinkbarUser: document.getElementById("previewUsername"),
  downloadPreviewBtn: document.getElementById("downloadPreviewBtn"),
  linkModal: document.getElementById("linkModal"),
  linkForm: document.getElementById("linkForm"),
  linkHasUrlToggle: document.getElementById("linkHasUrlToggle"),
  linkUrlField: document.getElementById("linkUrlField"),
  linkUrl: document.getElementById("linkUrl"),
  addLinkFeatureBtn: document.getElementById("addLinkFeatureBtn"),
  addLinkBtn: document.getElementById("addLinkBtn"),
  topbarAddBtn: document.getElementById("topbarAddBtn"),
  topbarPromptText: document.getElementById("topbarPromptText"),
  sidebarAddBtn: document.getElementById("sidebarAddBtn"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  modalTitle: document.getElementById("modalTitle"),
  footerSwitch: document.getElementById("footerSwitch"),
  inboxSection: document.getElementById("inboxSection"),
  inboxLayoutBtn: document.getElementById("inboxLayoutBtn"),
  inboxPanel: document.getElementById("inboxPanel"),
  inboxCloseBtn: document.getElementById("inboxCloseBtn"),
  inboxSwitch: document.getElementById("inboxSwitch"),
  inboxTitle: document.getElementById("inboxTitle"),
  inboxEditBtn: document.getElementById("inboxEditBtn"),
  inboxEditFormBtn: document.getElementById("inboxEditFormBtn"),
  inboxLayoutBody: document.getElementById("inboxLayoutBody"),
  previewInboxBanner: document.getElementById("previewInboxBanner"),
  previewInboxSheet: document.getElementById("previewInboxSheet"),
  previewInboxSheetBackdrop: document.getElementById("previewInboxSheetBackdrop"),
  previewInboxSheetClose: document.getElementById("previewInboxSheetClose"),
  previewInboxSheetTitle: document.getElementById("previewInboxSheetTitle"),
  previewInboxForm: document.getElementById("previewInboxForm"),
  previewCta: document.getElementById("previewCta"),
  editProfileBtn: document.getElementById("editProfileBtn"),
  profileModal: document.getElementById("profileModal"),
  profileForm: document.getElementById("profileForm"),
  profileNameInput: document.getElementById("profileNameInput"),
  profileUsernameInput: document.getElementById("profileUsernameInput"),
  profileMetaInput: document.getElementById("profileMetaInput"),
  closeProfileBtn: document.getElementById("closeProfileBtn"),
  bannerText: document.getElementById("bannerText"),
  socialModal: document.getElementById("socialModal"),
  socialModalTitle: document.getElementById("socialModalTitle"),
  socialForm: document.getElementById("socialForm"),
  socialUrl: document.getElementById("socialUrl"),
  closeSocialBtn: document.getElementById("closeSocialBtn"),
  openDesignBtn: document.getElementById("openDesignBtn"),
  designModal: document.getElementById("designModal"),
  designForm: document.getElementById("designForm"),
  closeDesignBtn: document.getElementById("closeDesignBtn"),
  profileImageFile: document.getElementById("profileImageFile"),
  profileImageHint: document.getElementById("profileImageHint"),
  backgroundImageFile: document.getElementById("backgroundImageFile"),
  backgroundImageHint: document.getElementById("backgroundImageHint"),
  backgroundColor: document.getElementById("backgroundColor"),
  buttonColor: document.getElementById("buttonColor"),
  profileFontColor: document.getElementById("profileFontColor"),
  buttonFontColor: document.getElementById("buttonFontColor"),
  backgroundColorPicker: document.getElementById("backgroundColorPicker"),
  buttonColorPicker: document.getElementById("buttonColorPicker"),
  profileFontColorPicker: document.getElementById("profileFontColorPicker"),
  buttonFontColorPicker: document.getElementById("buttonFontColorPicker"),
  resetDesignBtn: document.getElementById("resetDesignBtn"),
  footerUpgradeTip: document.getElementById("footerUpgradeTip"),
  cropModal: document.getElementById("cropModal"),
  cropImage: document.getElementById("cropImage"),
  cropTitle: document.getElementById("cropTitle"),
  closeCropBtn: document.getElementById("closeCropBtn"),
  cropCancelBtn: document.getElementById("cropCancelBtn"),
  cropSaveBtn: document.getElementById("cropSaveBtn"),
  inboxFormModal: document.getElementById("inboxFormModal"),
  inboxFormRows: document.getElementById("inboxFormRows"),
  closeInboxFormBtn: document.getElementById("closeInboxFormBtn"),
  dismissInboxFormBtn: document.getElementById("dismissInboxFormBtn"),
  inboxAddFieldBtn: document.getElementById("inboxAddFieldBtn"),
  inboxFormDoneBtn: document.getElementById("inboxFormDoneBtn"),
  inboxFieldLibraryModal: document.getElementById("inboxFieldLibraryModal"),
  inboxFieldLibraryList: document.getElementById("inboxFieldLibraryList"),
  inboxFieldSearchInput: document.getElementById("inboxFieldSearchInput"),
  inboxFieldLibraryBackBtn: document.getElementById("inboxFieldLibraryBackBtn"),
  dismissInboxFieldLibraryBtn: document.getElementById("dismissInboxFieldLibraryBtn"),
  inboxFieldConfigModal: document.getElementById("inboxFieldConfigModal"),
  inboxFieldConfigForm: document.getElementById("inboxFieldConfigForm"),
  inboxFieldTypeSelect: document.getElementById("inboxFieldTypeSelect"),
  inboxFieldLabelInput: document.getElementById("inboxFieldLabelInput"),
  inboxFieldRequiredInput: document.getElementById("inboxFieldRequiredInput"),
  inboxFieldChoicesSection: document.getElementById("inboxFieldChoicesSection"),
  inboxChoiceList: document.getElementById("inboxChoiceList"),
  inboxAddChoiceBtn: document.getElementById("inboxAddChoiceBtn"),
  inboxFieldConfigBackBtn: document.getElementById("inboxFieldConfigBackBtn"),
  dismissInboxFieldConfigBtn: document.getElementById("dismissInboxFieldConfigBtn"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  showProfileImage: document.getElementById("showProfileImage"),
  showDisplayName: document.getElementById("showDisplayName"),
  showBio: document.getElementById("showBio"),
  showSocialIcons: document.getElementById("showSocialIcons"),
  bannerSection: document.getElementById("bannerSection"),
  bannerSwitch: document.getElementById("bannerSwitch"),
  bannerAddBtn: document.getElementById("bannerAddBtn"),
  bannerItemsList: document.getElementById("bannerItemsList"),
  bannerRequirementNote: document.getElementById("bannerRequirementNote"),
  previewBannerMarquee: document.getElementById("previewBannerMarquee"),
  bannerModal: document.getElementById("bannerModal"),
  bannerModalTitle: document.getElementById("bannerModalTitle"),
  bannerForm: document.getElementById("bannerForm"),
  closeBannerBtn: document.getElementById("closeBannerBtn"),
  bannerImagePickBtn: document.getElementById("bannerImagePickBtn"),
  bannerImageResetBtn: document.getElementById("bannerImageResetBtn"),
  bannerImageInput: document.getElementById("bannerImageInput"),
  bannerImageHint: document.getElementById("bannerImageHint"),
  bannerImagePreview: document.getElementById("bannerImagePreview"),
  bannerHasLinkToggle: document.getElementById("bannerHasLinkToggle"),
  bannerLinkField: document.getElementById("bannerLinkField"),
  bannerLinkUrl: document.getElementById("bannerLinkUrl"),
  bannerPriceToggle: document.getElementById("bannerPriceToggle"),
  bannerPriceFields: document.getElementById("bannerPriceFields"),
  bannerPriceValue: document.getElementById("bannerPriceValue"),
  bannerPriceUnit: document.getElementById("bannerPriceUnit"),
};

let editingId = null;
let openLayoutId = "default-portfolio";
let draggingItemId = null;
let inboxOpen = false;
let inboxTab = "forms";
let cropper = null;
let cropCallback = null;
let preferredFieldType = "text";
let draftChoiceOptions = [];
let didBindDatePickerOutsideClick = false;
let editingBannerId = null;
let bannerDraftImage = "";

const CROP_RATIOS = {
  profile: 1,
  thumbnail: 16 / 9,
  background: 1 / 2,
};

function saveAll() {
  setStorageValue("profile", profile);
  setStorageValue("links", links);
  setStorageValue("social_links", socialLinks);
  setStorageValue("link_enabled_overrides", linkEnabledOverrides);
  setStorageValue("link_filter", activeLinkFilter);
  setStorageValue("appearance", appearance);
  setStorageValue("visibility", visibility);
  setStorageValue("inbox_position", inboxPosition);
  setStorageValue("banner_position", bannerPosition);
  setStorageValue("inbox_name", inboxName);
  setStorageValue("inbox_layout", inboxLayout);
  setStorageValue("inbox_fields", inboxFormFields);
  setStorageValue("banner_items", bannerItems);
  setStorageValue("banner_enabled", bannerEnabled);
}

function renderProfile() {
  if (elements.profileName) elements.profileName.textContent = profile.name;
  if (elements.profileMeta) elements.profileMeta.textContent = profile.bio;
  if (elements.previewName) elements.previewName.textContent = profile.name;
  if (elements.previewBio) elements.previewBio.textContent = profile.bio;
  if (elements.previewName) elements.previewName.style.display = visibility.showDisplayName ? "" : "none";
  if (elements.previewBio) elements.previewBio.style.display = visibility.showBio ? "" : "none";
  if (elements.previewSocialIcons) {
    elements.previewSocialIcons.style.display = visibility.showSocialIcons ? "" : "none";
  }
  updateAvatarInitials();
  const username = profile.username ? profile.username.trim() : "";
  if (elements.previewLinkbarUser) {
    elements.previewLinkbarUser.textContent = username
      ? `op4n.me/${username}`
      : "op4n.me/yours";
  }
  if (elements.previewCta) {
    elements.previewCta.textContent = username
      ? `OP4N.ME/${username.toUpperCase()}/>_SHARE ANYTHING`
      : "OP4N.ME/YOU/>_SHARE ANYTHING";
  }
}

function applyAppearance() {
  const phone = document.querySelector(".phone");
  if (phone) {
    phone.style.setProperty("--phone-profile-color", appearance.profileFontColor || "#111827");
    phone.style.setProperty("--phone-button-color", appearance.buttonColor || "#000000");
    phone.style.setProperty("--phone-button-text", appearance.buttonFontColor || "#f9fafb");
    phone.style.setProperty("--phone-link-color", appearance.buttonColor || "#000000");
    phone.style.setProperty("--phone-link-text", appearance.buttonFontColor || "#f9fafb");
    phone.style.backgroundColor = appearance.backgroundColor || "#ffffff";
    phone.style.backgroundImage = appearance.backgroundImageUrl
      ? `url(${appearance.backgroundImageUrl})`
      : "none";
  }

  const hasImage = Boolean(appearance.profileImageUrl);
  document.querySelectorAll(".profile-avatar").forEach((avatar) => {
    avatar.style.display = "";
    avatar.style.backgroundImage = hasImage ? `url(${appearance.profileImageUrl})` : "none";
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
    avatar.style.backgroundRepeat = "no-repeat";
    avatar.classList.toggle("has-image", hasImage);
  });
  document.querySelectorAll(".phone-avatar").forEach((avatar) => {
    avatar.style.display = visibility.showProfileImage ? "" : "none";
    avatar.style.backgroundImage = hasImage ? `url(${appearance.profileImageUrl})` : "none";
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
    avatar.style.backgroundRepeat = "no-repeat";
    avatar.classList.toggle("has-image", hasImage);
  });
}

function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ensureAvatarInitials(avatar) {
  let el = avatar.querySelector(".avatar-initials");
  if (!el) {
    el = document.createElement("span");
    el.className = "avatar-initials";
    el.setAttribute("aria-hidden", "true");
    avatar.appendChild(el);
  }
  return el;
}

function updateAvatarInitials() {
  const initials = getInitials(profile.name);
  const hasImage = Boolean(appearance.profileImageUrl);
  document.querySelectorAll(".profile-avatar, .phone-avatar").forEach((avatar) => {
    const el = ensureAvatarInitials(avatar);
    el.textContent = initials;
    avatar.classList.toggle("has-initials", !hasImage);
  });
}

function setImageHint(hintEl, message) {
  if (!hintEl) return;
  hintEl.textContent = message;
}

function readImageFile(file, onLoad) {
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.readAsDataURL(file);
}

function closeCropModal() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  cropCallback = null;
  elements.cropModal.classList.remove("is-open");
  elements.cropModal.setAttribute("aria-hidden", "true");
}

function openCropModal({ file, title, aspectRatio, onSave }) {
  if (!file || !elements.cropImage) return;
  cropCallback = onSave;
  elements.cropTitle.textContent = title || "Crop image";
  readImageFile(file, (dataUrl) => {
    elements.cropImage.src = dataUrl;
    if (cropper) cropper.destroy();
    cropper = new Cropper(elements.cropImage, {
      aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      responsive: true,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      zoomOnWheel: true,
    });
    elements.cropModal.classList.add("is-open");
    elements.cropModal.setAttribute("aria-hidden", "false");
  });
}

function saveCrop() {
  if (!cropper || !cropCallback) return;
  const canvas = cropper.getCroppedCanvas({
    imageSmoothingQuality: "high",
  });
  const dataUrl = canvas.toDataURL("image/png");
  cropCallback(dataUrl);
  closeCropModal();
}

function openDesignModal() {
  const backgroundIsLocal = appearance.backgroundImageUrl?.startsWith("data:");

  if (elements.profileImageFile) elements.profileImageFile.value = "";
  if (elements.backgroundImageFile) elements.backgroundImageFile.value = "";
  setImageHint(
    elements.backgroundImageHint,
    backgroundIsLocal ? "Using local file (stored in browser)." : "Supports JPG, PNG, WebP."
  );
  elements.backgroundColor.value = appearance.backgroundColor || "";
  elements.buttonColor.value = appearance.buttonColor || "";
  elements.profileFontColor.value = appearance.profileFontColor || "";
  elements.buttonFontColor.value = appearance.buttonFontColor || "";
  if (elements.backgroundColorPicker) {
    elements.backgroundColorPicker.value = appearance.backgroundColor || defaultAppearance.backgroundColor;
  }
  if (elements.buttonColorPicker) {
    elements.buttonColorPicker.value = appearance.buttonColor || defaultAppearance.buttonColor;
  }
  if (elements.profileFontColorPicker) {
    elements.profileFontColorPicker.value = appearance.profileFontColor || defaultAppearance.profileFontColor;
  }
  if (elements.buttonFontColorPicker) {
    elements.buttonFontColorPicker.value = appearance.buttonFontColor || defaultAppearance.buttonFontColor;
  }
  elements.designModal.classList.add("is-open");
}

function resetAppearance() {
  appearance.profileImageUrl = "";
  appearance.backgroundImageUrl = "";
  appearance.backgroundColor = defaultAppearance.backgroundColor;
  appearance.buttonColor = defaultAppearance.buttonColor;
  appearance.profileFontColor = defaultAppearance.profileFontColor;
  appearance.buttonFontColor = defaultAppearance.buttonFontColor;
  saveAll();
  applyAppearance();
  openDesignModal();
}

function closeDesignModal() {
  elements.designModal.classList.remove("is-open");
}

function renderSocialSlots() {
  document.querySelectorAll(".social-slot").forEach((slot) => {
    const key = slot.dataset.platform;
    const url = socialLinks[key];
    if (url) {
      slot.classList.add("is-filled");
      slot.setAttribute("title", url);
    } else {
      slot.classList.remove("is-filled");
      slot.removeAttribute("title");
    }
  });
}

let activeSocialSlot = null;

function openSocialModal(slot) {
  activeSocialSlot = slot;
  const label = slot.dataset.label || "social";
  elements.socialModalTitle.textContent = `Add ${label} link`;
  const currentUrl = socialLinks[slot.dataset.platform] || "";
  elements.socialUrl.value = currentUrl;
  elements.socialModal.classList.add("is-open");
}

function closeSocialModal() {
  elements.socialModal.classList.remove("is-open");
  activeSocialSlot = null;
}

function createLayoutPanel(link) {
  const panel = document.createElement("div");
  panel.className = `layout-card qr-panel${REQUIRED_DEFAULT_LINK_IDS.has(link?.id) ? " is-example" : ""}`;

  panel.innerHTML = `
    <div class="layout-bar">
      <h3>QR Code</h3>
      <button class="icon-btn layout-close-btn" aria-label="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="qr-tabs" role="tablist" aria-label="QR Code manager">
      <button class="qr-tab is-active" type="button" role="tab" aria-selected="true" data-qr-tab="preview">Preview</button>
      <button class="qr-tab" type="button" role="tab" aria-selected="false" data-qr-tab="setting">Setting</button>
    </div>
    <div class="layout-body">
      <div class="qr-tab-panel is-active" data-qr-panel="preview" role="tabpanel">
        <div class="qr-preview-card">
          <div class="qr-code-preview" aria-label="QR Code preview"></div>
          <div class="qr-preview-copy">
            <p class="link-title">${escapeHTML(link.title || "Untitled")}</p>
            <p class="muted">${getShortLink(link)}</p>
            <button class="qr-download-btn" type="button">
              <span class="material-symbols-outlined" aria-hidden="true">download</span>
              Download QR Code
            </button>
          </div>
        </div>
      </div>
      <div class="qr-tab-panel" data-qr-panel="setting" role="tabpanel">
        <div class="qr-upgrade-note">
          <span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>
          <span>Upgrade to customize your QR Code with a center logo and frame.</span>
        </div>
        <div class="qr-setting-grid">
          <label class="qr-setting-option is-locked">
            <span class="qr-setting-head">
              <span>Logo in center</span>
              <span class="qr-lock">Upgrade</span>
            </span>
            <button class="add-thumbnail-btn" type="button" disabled>
              <span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
              Upload logo
            </button>
            <span class="thumbnail-hint">Available after upgrade.</span>
          </label>
          <label class="qr-setting-option is-locked">
            <span class="qr-setting-head">
              <span>QR Code frame</span>
              <span class="qr-lock">Upgrade</span>
            </span>
            <select class="qr-frame-select" disabled>
              <option>Clean frame</option>
              <option>Rounded card</option>
              <option>Scan me badge</option>
            </select>
            <span class="thumbnail-hint">Choose a frame style on a paid plan.</span>
          </label>
        </div>
      </div>
    </div>
  `;

  // Generate QR code
  const qrContainer = panel.querySelector(".qr-code-preview");
  const shortLink = getShortLink(link);
  if (qrContainer && typeof QRCode !== "undefined") {
    new QRCode(qrContainer, {
      text: shortLink,
      width: 160,
      height: 160,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  // Download QR code
  panel.querySelector(".qr-download-btn").addEventListener("click", () => {
    const canvas = panel.querySelector(".qr-code-preview canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${link.shortCode || link.id}.png`;
    a.click();
  });

  // Close button
  panel.querySelector(".layout-close-btn").addEventListener("click", () => {
    openLayoutId = null;
    renderLinks();
  });

  panel.querySelectorAll("[data-qr-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const nextTab = tab.dataset.qrTab;
      panel.querySelectorAll("[data-qr-tab]").forEach((button) => {
        const isActive = button.dataset.qrTab === nextTab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      panel.querySelectorAll("[data-qr-panel]").forEach((tabPanel) => {
        tabPanel.classList.toggle("is-active", tabPanel.dataset.qrPanel === nextTab);
      });
    });
  });

  return panel;
}

function setInboxOpen(value) {
  inboxOpen = value;
  if (!elements.inboxSection || !elements.inboxLayoutBtn) return;
  elements.inboxSection.classList.toggle("is-open", inboxOpen);
  elements.inboxLayoutBtn.classList.toggle("is-active", inboxOpen);
}

function setInboxTab(tab) {
  inboxTab = tab;
  if (!elements.inboxSection) return;
  const tabs = elements.inboxSection.querySelectorAll("[data-inbox-tab]");
  const panels = elements.inboxSection.querySelectorAll("[data-inbox-panel]");
  tabs.forEach((btn) => {
    const isActive = btn.dataset.inboxTab === inboxTab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  panels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.inboxPanel === inboxTab);
  });

  if (inboxTab === "layout") {
    renderInboxLayoutOptions();
  }
}

function setInboxSheetOpen(value) {
  if (!elements.previewInboxSheet || !elements.previewInboxSheetBackdrop) return;
  elements.previewInboxSheet.classList.toggle("is-open", value);
  elements.previewInboxSheetBackdrop.classList.toggle("is-open", value);
  if (elements.previewInboxSheetTitle) {
    elements.previewInboxSheetTitle.textContent = inboxName;
  }
}

function isBannerReady() {
  return bannerItems.length >= 3;
}

function updateBannerRequirementState() {
  if (!elements.bannerRequirementNote) return;
  const ready = isBannerReady();
  elements.bannerRequirementNote.classList.toggle("is-ready", ready);
  elements.bannerRequirementNote.textContent = `Add at least 3 banners to enable infinite slide in preview. (${bannerItems.length}/3)`;
}

function updateBannerModalImageUI() {
  if (!elements.bannerImagePreview || !elements.bannerImageHint) return;
  if (bannerDraftImage) {
    elements.bannerImagePreview.innerHTML = `<img src="${escapeHTML(bannerDraftImage)}" alt="" />`;
    elements.bannerImageHint.textContent = "Image ready.";
  } else {
    elements.bannerImagePreview.innerHTML = "";
    elements.bannerImageHint.textContent = "No image selected.";
  }
}

function updateBannerPriceVisibility() {
  if (!elements.bannerPriceFields || !elements.bannerPriceToggle) return;
  const shouldShow = Boolean(elements.bannerPriceToggle.checked);
  elements.bannerPriceFields.hidden = !shouldShow;
  if (!shouldShow) {
    if (elements.bannerPriceValue) elements.bannerPriceValue.value = "";
    if (elements.bannerPriceUnit) elements.bannerPriceUnit.value = "";
  }
}

function updateBannerLinkVisibility() {
  if (!elements.bannerHasLinkToggle) return;
  const shouldShow = Boolean(elements.bannerHasLinkToggle.checked);
  if (elements.bannerLinkField) {
    elements.bannerLinkField.hidden = !shouldShow;
  }
  if (elements.bannerLinkUrl) {
    elements.bannerLinkUrl.disabled = !shouldShow;
    elements.bannerLinkUrl.required = shouldShow;
  }
}

function openBannerModal(id = null) {
  if (!elements.bannerModal || !elements.bannerForm) return;
  editingBannerId = id;
  const target = id ? bannerItems.find((item) => item.id === id) : null;
  if (elements.bannerModalTitle) {
    elements.bannerModalTitle.textContent = target ? "Edit banner" : "Add banner";
  }
  elements.bannerForm.reset();
  if (elements.bannerImageInput) {
    elements.bannerImageInput.value = "";
  }
  bannerDraftImage = target?.image || "";
  if (elements.bannerHasLinkToggle) {
    elements.bannerHasLinkToggle.checked = target
      ? Boolean(typeof target.hasLink === "boolean" ? target.hasLink : target.url)
      : true;
  }
  if (elements.bannerLinkUrl) {
    elements.bannerLinkUrl.value = target?.url || "";
  }
  if (elements.bannerPriceToggle) {
    elements.bannerPriceToggle.checked = Boolean(target?.showPrice);
  }
  if (elements.bannerPriceValue) {
    elements.bannerPriceValue.value = target?.price || "";
  }
  if (elements.bannerPriceUnit) {
    elements.bannerPriceUnit.value = target?.unit || "";
  }
  updateBannerModalImageUI();
  updateBannerLinkVisibility();
  updateBannerPriceVisibility();
  elements.bannerModal.classList.add("is-open");
  elements.bannerModal.setAttribute("aria-hidden", "false");
}

function closeBannerModal() {
  if (!elements.bannerModal) return;
  elements.bannerModal.classList.remove("is-open");
  elements.bannerModal.setAttribute("aria-hidden", "true");
  editingBannerId = null;
  bannerDraftImage = "";
}

function renderBannerItems() {
  if (!elements.bannerItemsList) return;
  updateBannerRequirementState();
  const ready = isBannerReady();
  if (elements.bannerSwitch) {
    elements.bannerSwitch.checked = ready && bannerEnabled;
    elements.bannerSwitch.disabled = !ready;
  }

  if (!bannerItems.length) {
    elements.bannerItemsList.innerHTML = `<div class="banner-empty">No banner items yet. Add at least 3.</div>`;
    return;
  }

  elements.bannerItemsList.innerHTML = bannerItems.map((item, index) => {
    const safeUrl = item.hasLink && item.url
      ? escapeHTML(item.url)
      : '<span class="banner-item-url-empty">No link</span>';
    const showPrice = item.showPrice && item.price;
    const badge = showPrice
      ? `<div class="banner-item-price">${escapeHTML(item.price)}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}</div>`
      : "";
    return `
      <article class="banner-item-card" data-banner-id="${escapeHTML(item.id)}">
        <div class="banner-item-left">
          <div class="banner-item-thumb"><img src="${escapeHTML(item.image)}" alt="Banner ${index + 1}" /></div>
          <div class="banner-item-copy">
            <div class="banner-item-url">${safeUrl}</div>
            ${badge}
          </div>
        </div>
        <div class="banner-item-actions">
          <button class="icon-btn-sm banner-edit-btn" type="button" aria-label="Edit banner">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="icon-btn-sm banner-delete-btn" type="button" aria-label="Delete banner">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </article>
    `;
  }).join("");

  elements.bannerItemsList.querySelectorAll(".banner-item-card").forEach((card) => {
    const id = card.dataset.bannerId;
    const editBtn = card.querySelector(".banner-edit-btn");
    const deleteBtn = card.querySelector(".banner-delete-btn");
    if (editBtn) {
      editBtn.addEventListener("click", () => openBannerModal(id));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        bannerItems = bannerItems.filter((item) => item.id !== id);
        if (!isBannerReady()) {
          bannerEnabled = false;
        }
        saveAll();
        renderBannerItems();
        renderPreview();
      });
    }
  });
}

function renderPreviewBannerMarquee() {
  if (!elements.previewBannerMarquee) return;
  const shouldShow = bannerEnabled && isBannerReady();
  elements.previewBannerMarquee.classList.toggle("is-visible", shouldShow);
  if (!shouldShow) {
    elements.previewBannerMarquee.innerHTML = "";
    return false;
  }

  const content = bannerItems.map((item) => {
    const price = item.showPrice && item.price
      ? `<span class="marquee-price">${escapeHTML(item.price)}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}</span>`
      : "";
    const inner = `
      <img src="${escapeHTML(item.image)}" alt="" />
      ${price}
    `;
    if (item.hasLink && item.url) {
      return `
        <a class="marquee-item" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">
          ${inner}
        </a>
      `;
    }
    return `
      <div class="marquee-item is-static">
        ${inner}
      </div>
    `;
  }).join("");

  elements.previewBannerMarquee.innerHTML = `
    <div class="marquee-track">
      ${content}
      ${content}
    </div>
  `;
  return true;
}

function renderInboxBanner() {
  if (!elements.previewInboxBanner) return;
  const isBanner = inboxLayout.type === "banner";
  const isVisible = isBanner && elements.inboxSwitch?.checked;
  elements.previewInboxBanner.classList.toggle("is-visible", Boolean(isVisible));
  if (!isVisible) return;

  const bannerTitle = escapeHTML(inboxName);
  elements.previewInboxBanner.className = "phone-bottom-banner is-visible";
  elements.previewInboxBanner.innerHTML = `
    <div class="banner-handle">
      <div class="banner-title">${bannerTitle}</div>
      <button class="banner-toggle" type="button" aria-label="Open form">
        <span class="material-symbols-outlined">keyboard_arrow_up</span>
      </button>
    </div>
  `;

  const toggleBtn = elements.previewInboxBanner.querySelector(".banner-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (event) => {
      event.preventDefault();
      setInboxSheetOpen(true);
    });
  }
  elements.previewInboxBanner.addEventListener("click", (event) => {
    if (event.target.closest(".banner-toggle")) return;
    setInboxSheetOpen(true);
  });
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDatePretty(value) {
  if (!value) return "Select date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Select date";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function renderDatePickerCalendar(picker) {
  if (!picker) return;
  const year = Number(picker.dataset.viewYear);
  const month = Number(picker.dataset.viewMonth);
  const monthLabel = picker.querySelector(".sheet-date-month");
  const grid = picker.querySelector(".sheet-date-grid");
  const trigger = picker.querySelector(".sheet-date-trigger");
  if (!monthLabel || !grid || !trigger) return;

  const currentMonthDate = new Date(year, month, 1);
  monthLabel.textContent = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(currentMonthDate);
  trigger.textContent = formatDatePretty(picker.dataset.selectedDate || "");

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selected = picker.dataset.selectedDate || "";

  let cells = "";
  for (let i = 0; i < firstDay; i += 1) {
    cells += `<span class="sheet-date-blank" aria-hidden="true"></span>`;
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = formatDateValue(new Date(year, month, day));
    const isSelected = selected === value;
    cells += `
      <button class="sheet-date-day${isSelected ? " is-selected" : ""}" type="button" data-date-value="${value}">
        ${day}
      </button>
    `;
  }

  grid.innerHTML = cells;
  grid.querySelectorAll(".sheet-date-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      picker.dataset.selectedDate = btn.dataset.dateValue || "";
      picker.querySelector(".sheet-date-popover")?.setAttribute("hidden", "true");
      renderDatePickerCalendar(picker);
    });
  });
}

function wirePreviewDatePickers() {
  const pickers = elements.previewInboxForm?.querySelectorAll(".sheet-date-picker") || [];
  pickers.forEach((picker) => {
    if (!picker.dataset.viewYear || !picker.dataset.viewMonth) {
      const now = new Date();
      picker.dataset.viewYear = String(now.getFullYear());
      picker.dataset.viewMonth = String(now.getMonth());
    }
    const trigger = picker.querySelector(".sheet-date-trigger");
    const popover = picker.querySelector(".sheet-date-popover");
    const prevBtn = picker.querySelector(".sheet-date-prev");
    const nextBtn = picker.querySelector(".sheet-date-next");
    if (!trigger || !popover || !prevBtn || !nextBtn) return;

    renderDatePickerCalendar(picker);

    trigger.addEventListener("click", () => {
      const isHidden = popover.hasAttribute("hidden");
      pickers.forEach((item) => {
        item.querySelector(".sheet-date-popover")?.setAttribute("hidden", "true");
      });
      if (isHidden) {
        popover.removeAttribute("hidden");
      }
    });

    prevBtn.addEventListener("click", () => {
      let year = Number(picker.dataset.viewYear);
      let month = Number(picker.dataset.viewMonth) - 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
      picker.dataset.viewYear = String(year);
      picker.dataset.viewMonth = String(month);
      renderDatePickerCalendar(picker);
    });

    nextBtn.addEventListener("click", () => {
      let year = Number(picker.dataset.viewYear);
      let month = Number(picker.dataset.viewMonth) + 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      picker.dataset.viewYear = String(year);
      picker.dataset.viewMonth = String(month);
      renderDatePickerCalendar(picker);
    });
  });

  if (didBindDatePickerOutsideClick) return;
  didBindDatePickerOutsideClick = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest(".sheet-date-picker")) return;
    document
      .querySelectorAll(".sheet-date-popover")
      .forEach((popover) => popover.setAttribute("hidden", "true"));
  });
}

function renderPreviewInboxForm() {
  if (!elements.previewInboxForm) return;

  const fieldsHTML = inboxFormFields.map((field) => {
    const labelSuffix = field.required ? "(required)" : "(optional)";
    const label = `${field.label} ${labelSuffix}`;
    const safeLabel = escapeHTML(label);
    const safePlaceholder = escapeHTML(field.label);
    const isRequired = field.required ? "required" : "";

    if (field.type === "date") {
      return `
        <label class="sheet-field">
          <span>${safeLabel}</span>
          <div class="sheet-date-picker" data-field-id="${escapeHTML(field.id)}">
            <button class="sheet-date-trigger" type="button">Select date</button>
            <div class="sheet-date-popover" hidden>
              <div class="sheet-date-head">
                <button class="sheet-date-nav sheet-date-prev" type="button" aria-label="Previous month">
                  <span class="material-symbols-outlined">chevron_left</span>
                </button>
                <span class="sheet-date-month"></span>
                <button class="sheet-date-nav sheet-date-next" type="button" aria-label="Next month">
                  <span class="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
              <div class="sheet-date-weekdays">
                <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
              </div>
              <div class="sheet-date-grid"></div>
            </div>
          </div>
        </label>
      `;
    }

    if (field.type === "textarea") {
      return `
        <label class="sheet-field">
          <span>${safeLabel}</span>
          <textarea placeholder="${safePlaceholder}" ${isRequired}></textarea>
        </label>
      `;
    }

    if (field.type === "dropdown") {
      const options = normalizeChoices(field.choices);
      const optionHTML = options.map((choice) => `<option>${escapeHTML(choice)}</option>`).join("");
      return `
        <label class="sheet-field">
          <span>${safeLabel}</span>
          <select ${isRequired}>
            <option value="">Select</option>
            ${optionHTML}
          </select>
        </label>
      `;
    }

    if (field.type === "tel") {
      return `
        <label class="sheet-field">
          <span>${safeLabel}</span>
          <div class="sheet-phone-row">
            <select aria-label="Country code">
              <option value="+66">+66</option>
              <option value="+1">+1</option>
              <option value="+44">+44</option>
            </select>
            <input type="tel" placeholder="Phone number" ${isRequired} />
          </div>
        </label>
      `;
    }

    if (field.type === "single_choice" || field.type === "checkboxes") {
      const options = normalizeChoices(field.choices);
      const inputType = field.type === "single_choice" ? "radio" : "checkbox";
      const groupName = `preview-${field.id}`;
      const optionsHTML = options.map((choice, index) => `
        <label class="sheet-choice-item">
          <input type="${inputType}" name="${escapeHTML(groupName)}" ${isRequired && index === 0 ? "required" : ""} />
          <span>${escapeHTML(choice)}</span>
        </label>
      `).join("");
      return `
        <fieldset class="sheet-choice-group">
          <legend>${safeLabel}</legend>
          ${optionsHTML}
        </fieldset>
      `;
    }

    const inputType = field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
    return `
      <label class="sheet-field">
        <span>${safeLabel}</span>
        <input type="${inputType}" placeholder="${safePlaceholder}" ${isRequired} />
      </label>
    `;
  }).join("");

  elements.previewInboxForm.innerHTML = `
    ${fieldsHTML}
    <button class="sheet-submit" type="button" disabled>Send</button>
    <p class="sheet-footnote">
      By submitting, you agree to op4n.me's T&amp;Cs and Privacy Notice.
    </p>
  `;
  wirePreviewDatePickers();
}

function renderInboxFormEditor() {
  if (!elements.inboxFormRows) return;
  elements.inboxFormRows.innerHTML = inboxFormFields.map((field) => `
    <div class="inbox-form-row" data-field-id="${escapeHTML(field.id)}">
      <span class="material-symbols-outlined inbox-row-drag">drag_indicator</span>
      <span class="inbox-row-label">${escapeHTML(field.label)}</span>
      <input class="inbox-row-required" type="checkbox" ${field.required ? "checked" : ""} aria-label="Required ${escapeHTML(field.label)}" />
      <button class="inbox-row-remove" type="button" aria-label="Remove ${escapeHTML(field.label)}">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join("");

  elements.inboxFormRows.querySelectorAll(".inbox-form-row").forEach((row) => {
    const id = row.dataset.fieldId;
    const requiredInput = row.querySelector(".inbox-row-required");
    const removeBtn = row.querySelector(".inbox-row-remove");

    if (requiredInput) {
      requiredInput.addEventListener("change", () => {
        const target = inboxFormFields.find((field) => field.id === id);
        if (!target) return;
        target.required = requiredInput.checked;
        saveAll();
        renderPreviewInboxForm();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        if (inboxFormFields.length <= 1) return;
        inboxFormFields = inboxFormFields.filter((field) => field.id !== id);
        saveAll();
        renderInboxFormEditor();
        renderPreviewInboxForm();
      });
    }
  });
}

function openSimpleModal(modal) {
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeSimpleModal(modal) {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

function closeAllInboxFormModals() {
  closeSimpleModal(elements.inboxFormModal);
  closeSimpleModal(elements.inboxFieldLibraryModal);
  closeSimpleModal(elements.inboxFieldConfigModal);
}

function openInboxFormModal() {
  renderInboxFormEditor();
  openSimpleModal(elements.inboxFormModal);
}

function openInboxFieldLibraryModal() {
  closeSimpleModal(elements.inboxFormModal);
  openSimpleModal(elements.inboxFieldLibraryModal);
  renderInboxFieldLibrary(elements.inboxFieldSearchInput?.value || "");
}

function openInboxFieldConfigModal(type = "text", label = "") {
  preferredFieldType = type;
  draftChoiceOptions = isChoiceType(preferredFieldType) ? ["Option 1", "Option 2"] : [];
  if (elements.inboxFieldTypeSelect) {
    elements.inboxFieldTypeSelect.value = preferredFieldType;
  }
  if (elements.inboxFieldLabelInput) {
    elements.inboxFieldLabelInput.value = label || prettyFieldType(preferredFieldType);
  }
  if (elements.inboxFieldRequiredInput) {
    elements.inboxFieldRequiredInput.checked = false;
  }
  renderChoiceInputs();
  closeSimpleModal(elements.inboxFieldLibraryModal);
  openSimpleModal(elements.inboxFieldConfigModal);
}

function renderChoiceInputs() {
  const section = elements.inboxFieldChoicesSection;
  const list = elements.inboxChoiceList;
  if (!section || !list) return;
  const isChoiceField = isChoiceType(preferredFieldType);
  section.hidden = !isChoiceField;
  if (!isChoiceField) {
    list.innerHTML = "";
    return;
  }
  if (!draftChoiceOptions.length) {
    draftChoiceOptions = ["Option 1"];
  }
  list.innerHTML = draftChoiceOptions.map((choice, index) => `
    <div class="inbox-choice-row" data-choice-index="${index}">
      <input class="inbox-choice-input" type="text" value="${escapeHTML(choice)}" placeholder="Option ${index + 1}" />
      <button class="inbox-choice-remove" type="button" aria-label="Remove option ${index + 1}">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join("");

  list.querySelectorAll(".inbox-choice-row").forEach((row) => {
    const index = Number(row.dataset.choiceIndex);
    const input = row.querySelector(".inbox-choice-input");
    const removeBtn = row.querySelector(".inbox-choice-remove");
    if (input) {
      input.addEventListener("input", () => {
        draftChoiceOptions[index] = input.value;
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        if (draftChoiceOptions.length <= 1) return;
        draftChoiceOptions.splice(index, 1);
        renderChoiceInputs();
      });
    }
  });
}

function renderInboxFieldLibrary(searchQuery = "") {
  if (!elements.inboxFieldLibraryList) return;
  const q = searchQuery.trim().toLowerCase();
  const options = [
    { type: "text", label: "Your Message" },
    { type: "text", label: "Country" },
    { type: "date", label: "Date of birth" },
    { type: "textarea", label: "Message" },
    { type: "text", label: "Short answer" },
    { type: "textarea", label: "Paragraph" },
    { type: "single_choice", label: "Single choice" },
    { type: "checkboxes", label: "Checkboxes" },
    { type: "dropdown", label: "Dropdown" },
    { type: "date", label: "Date" },
  ];

  const filtered = options.filter((item) => !q || item.label.toLowerCase().includes(q));
  let html = "";
  filtered.forEach((item, index) => {
    html += `
      <button class="inbox-library-item" type="button" data-item-id="${index}">
        <span>${escapeHTML(item.label)}</span>
        <span class="material-symbols-outlined">add</span>
      </button>
    `;
  });

  if (!html) {
    html = `<div class="inbox-panel-desc">No field found.</div>`;
  }

  elements.inboxFieldLibraryList.innerHTML = html;

  elements.inboxFieldLibraryList.querySelectorAll(".inbox-library-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.querySelector("span")?.textContent?.trim() || "Short answer";
      const selected = options.find((item) => item.label === text);
      openInboxFieldConfigModal(selected?.type || "text", selected?.label || text);
    });
  });
}

function renderInboxLayoutOptions() {
  if (!elements.inboxLayoutBody) return;

  const layoutOptions = [
    {
      id: "banner",
      title: "Banner",
      desc: "Sticky bottom banner that opens a contact sheet.",
      preview: `
        <div class="layout-preview">
          <div class="layout-preview-banner">
            <span class="preview-caption">Get in touch</span>
            <span class="preview-dots">...</span>
          </div>
        </div>
      `,
    },
    {
      id: "classic",
      title: "Classic",
      desc: "Efficient, direct and compact.",
      preview: `
        <div class="layout-preview">
          <div class="layout-preview-classic">
            <div class="preview-avatar-sm"></div>
            <div class="preview-bar"></div>
            <span class="preview-dots">...</span>
          </div>
        </div>
      `,
    },
  ];

  let optionsHTML = "";
  layoutOptions.forEach((option) => {
    const isSelected = option.id === inboxLayout.type;

    optionsHTML += `
      <label class="layout-option${isSelected ? " is-selected" : ""}" data-layout="${option.id}">
        <input type="radio" name="layout-inbox" value="${option.id}" ${isSelected ? "checked" : ""} />
        <div class="layout-text">
          <div class="link-title">${option.title}</div>
          <div class="muted">${option.desc}</div>
        </div>
        ${option.preview}
      </label>
    `;
  });

  elements.inboxLayoutBody.innerHTML = optionsHTML;

  elements.inboxLayoutBody.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.addEventListener("change", () => {
      inboxLayout.type = input.value;
      saveAll();
      renderPreview();
      renderInboxLayoutOptions();
    });
  });
}

function getCombinedOrder() {
  const order = links.map((link) => link.id);
  const specials = [
    { id: "inbox", position: inboxPosition },
    { id: "banner", position: bannerPosition },
  ].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  specials.forEach((special) => {
    const clamped = Math.max(0, Math.min(special.position, order.length));
    order.splice(clamped, 0, special.id);
  });
  return order;
}

function applyCombinedOrder(order) {
  inboxPosition = order.indexOf("inbox");
  bannerPosition = order.indexOf("banner");
  const map = new Map(links.map((link) => [link.id, link]));
  links.length = 0;
  order.forEach((id) => {
    if (id === "inbox" || id === "banner") return;
    const item = map.get(id);
    if (item) links.push(item);
  });
  saveAll();
}

function createLinkFilterBar() {
  const filters = [
    { id: "example", label: "Example" },
    { id: "created", label: "Created Link" },
  ];
  const bar = document.createElement("div");
  bar.className = "link-filter-bar";
  bar.setAttribute("aria-label", "Filter links");
  bar.innerHTML = filters.map((filter) => {
    const isActive = activeLinkFilter === filter.id;
    return `
      <button class="link-filter-pill${isActive ? " is-active" : ""}" type="button" data-link-filter="${filter.id}" aria-pressed="${isActive}">
        <span>${filter.label}</span>
      </button>
    `;
  }).join("");
  bar.querySelectorAll("[data-link-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeLinkFilter = button.dataset.linkFilter;
      saveAll();
      renderLinks();
    });
  });
  return bar;
}

function renderLinks() {
  if (!elements.linksList) return;
  elements.linksList.innerHTML = "";
  if (elements.inboxTitle) {
    elements.inboxTitle.textContent = inboxName;
  }
  const order = getCombinedOrder();
  const inboxSection = elements.inboxSection;
  const bannerSection = elements.bannerSection;
  if (inboxSection && inboxSection.parentElement !== elements.linksList) {
    inboxSection.remove();
  }
  if (bannerSection && bannerSection.parentElement !== elements.linksList) {
    bannerSection.remove();
  }

  const attachDragHandlers = (target, targetId, dragHandle) => {
    if (!target || !dragHandle) return;
    dragHandle.setAttribute("draggable", "true");
    dragHandle.addEventListener("dragstart", (event) => {
      draggingItemId = targetId;
      target.classList.add("is-dragging");
      event.dataTransfer.setData("text/plain", targetId);
      event.dataTransfer.effectAllowed = "move";
    });
    dragHandle.addEventListener("dragend", () => {
      draggingItemId = null;
      target.classList.remove("is-dragging");
    });

    target.addEventListener("dragover", (event) => {
      if (!draggingItemId || draggingItemId === targetId) return;
      event.preventDefault();
      target.classList.add("drag-over");
    });

    target.addEventListener("dragleave", () => {
      target.classList.remove("drag-over");
    });

    target.addEventListener("drop", (event) => {
      if (!draggingItemId || draggingItemId === targetId) return;
      event.preventDefault();
      target.classList.remove("drag-over");
      const currentOrder = getCombinedOrder();
      const fromIndex = currentOrder.indexOf(draggingItemId);
      const toIndex = currentOrder.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = currentOrder.splice(fromIndex, 1);
      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      currentOrder.splice(insertIndex, 0, moved);
      applyCombinedOrder(currentOrder);
      renderLinks();
      renderPreview();
    });
  };

  elements.linksList.appendChild(createLinkFilterBar());

  const visibleLinkIds = new Set(
    links
      .filter((link) => getLinkFilterType(link) === activeLinkFilter)
      .map((link) => link.id)
  );

  order.forEach((itemId) => {
    if (itemId === "inbox" && inboxSection) {
      if (activeLinkFilter !== "created") return;
      elements.linksList.appendChild(inboxSection);
      attachDragHandlers(inboxSection, "inbox", inboxSection.querySelector(".inbox-header-left"));
      return;
    }
    if (itemId === "banner" && bannerSection) {
      if (activeLinkFilter !== "created") return;
      elements.linksList.appendChild(bannerSection);
      attachDragHandlers(bannerSection, "banner", bannerSection.querySelector(".inbox-header-left"));
      return;
    }
    const link = links.find((entry) => entry.id === itemId);
    if (!link) return;
    if (!visibleLinkIds.has(link.id)) return;
    const card = document.createElement("div");
    card.className = "link-card";

    const safeTitle = escapeHTML(link.title);
    const hasUrl = Boolean(typeof link.hasUrl === "boolean" ? link.hasUrl : link.url);
    const safeUrl = hasUrl ? escapeHTML(link.url) : "No destination URL";
    const displayUrl = hasUrl
      ? (link.url.length > 45 ? escapeHTML(link.url.substring(0, 45) + "...") : safeUrl)
      : safeUrl;
    const shortLink = getShortLink(link);
    const isLayoutOpen = openLayoutId === link.id;
    const isLockedDefault = Boolean(link.locked);
    const isExampleLink = REQUIRED_DEFAULT_LINK_IDS.has(link.id);
    const exampleLabel = isExampleLink ? '<div class="link-example-label">Example</div>' : "";
    if (isExampleLink) {
      card.classList.add("is-example");
    }
    const editLockedAttrs = isLockedDefault
      ? 'disabled aria-disabled="true" title="Sign up to edit default links"'
      : "";
    const deleteLockedAttrs = isLockedDefault
      ? 'disabled aria-disabled="true" title="Sign up to delete default links"'
      : "";

    card.innerHTML = `
      ${exampleLabel}
      <div class="link-row">
        <div class="link-drag">
          <span class="material-symbols-outlined">drag_indicator</span>
        </div>
        <div class="link-info">
          <div class="link-title-row">
            <span class="link-title">${safeTitle}</span>
            <button class="icon-btn-sm edit-title-btn" aria-label="Edit title" ${editLockedAttrs}>
              <span class="material-symbols-outlined">edit</span>
            </button>
          </div>
          <div class="link-short-row">
            <a class="link-short-url" href="${shortLink}" target="_blank" rel="noopener noreferrer">${shortLink}</a>
            <button class="icon-btn-sm copy-link-btn" type="button" aria-label="Copy link">
              <span class="material-symbols-outlined">content_copy</span>
            </button>
          </div>
          <div class="link-url-row">
            <span class="link-url${hasUrl ? "" : " is-empty"}">${displayUrl}</span>
            <button class="icon-btn-sm edit-url-btn" aria-label="Edit URL" ${editLockedAttrs}>
              <span class="material-symbols-outlined">edit</span>
            </button>
          </div>
        </div>
        <div class="link-right">
          <label class="switch">
            <input type="checkbox" ${getLinkEnabled(link) ? "checked" : ""} ${isExampleLink ? 'disabled aria-disabled="true" title="Example links stay off"' : ""} />
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="link-meta-row">
        <div class="link-tool-icons">
          <button class="icon-btn-sm layout-toggle-btn${isLayoutOpen ? " is-active" : ""}" aria-label="QR Code">
            <span class="material-symbols-outlined">qr_code_2</span>
          </button>
          <button class="icon-btn-sm" aria-label="Pin">
            <span class="material-symbols-outlined">push_pin</span>
          </button>
          <button class="icon-btn-sm" aria-label="Thumbnail">
            <span class="material-symbols-outlined">image</span>
          </button>
          <button class="icon-btn-sm" aria-label="Favorite">
            <span class="material-symbols-outlined">star</span>
          </button>
          <button class="icon-btn-sm" aria-label="Copy">
            <span class="material-symbols-outlined">content_copy</span>
          </button>
          <button class="icon-btn-sm" aria-label="Lock">
            <span class="material-symbols-outlined">lock</span>
          </button>
          <span class="link-stats">
            <span class="material-symbols-outlined">bar_chart</span>
            0 clicks
          </span>
        </div>
        <button class="icon-btn-sm link-delete" aria-label="Delete" ${deleteLockedAttrs}>
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    `;

    // Toggle event
    card
      .querySelector(".link-right .switch input")
      .addEventListener("change", (event) => {
        setLinkEnabled(link, event.target.checked);
        saveAll();
        renderPreview();
      });

    // Inline edit handlers (same behavior pattern as Inbox title edit)
    const startInlineEdit = ({ selector, value, className, onCommit }) => {
      const currentNode = card.querySelector(selector);
      if (!currentNode) return;
      const currentValue = value;
      const input = document.createElement("input");
      input.type = "text";
      input.value = currentValue;
      input.className = className;
      currentNode.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        onCommit(input.value, currentValue);
      };

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          input.value = currentValue;
          input.blur();
        }
      });
    };

    const editTitleBtn = card.querySelector(".edit-title-btn");
    if (editTitleBtn) {
      editTitleBtn.addEventListener("click", () => {
        if (isLockedDefault) return;
        startInlineEdit({
          selector: ".link-title",
          value: link.title || "",
          className: "inbox-title-input",
          onCommit: (nextValue, fallbackValue) => {
            const next = nextValue.trim() || fallbackValue || "Untitled";
            link.title = next;
            saveAll();
            renderLinks();
            renderPreview();
          },
        });
      });
    }

    const copyLinkBtn = card.querySelector(".copy-link-btn");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", () => {
        const shortLinkText = shortLink;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(shortLinkText).catch(() => {
            prompt("Copy link", shortLinkText);
          });
        } else {
          prompt("Copy link", shortLinkText);
        }
      });
    }

    const editUrlBtn = card.querySelector(".edit-url-btn");
    if (editUrlBtn) {
      editUrlBtn.addEventListener("click", () => {
        if (isLockedDefault) return;
        startInlineEdit({
          selector: ".link-url",
          value: link.url || "",
          className: "inbox-title-input link-url-input",
          onCommit: (nextValue, fallbackValue) => {
            const next = nextValue.trim() || fallbackValue || "";
            link.url = next;
            link.hasUrl = Boolean(next);
            saveAll();
            renderLinks();
            renderPreview();
          },
        });
      });
    }

    // Layout toggle button
    card.querySelector(".layout-toggle-btn").addEventListener("click", () => {
      openLayoutId = openLayoutId === link.id ? null : link.id;
      renderLinks();
    });

    // Delete event
    card.querySelector(".link-delete").addEventListener("click", () => {
      if (isLockedDefault) return;
      const index = links.findIndex((item) => item.id === link.id);
      if (index > -1) {
        links.splice(index, 1);
        if (openLayoutId === link.id) openLayoutId = null;
        saveAll();
        renderLinks();
        renderPreview();
      }
    });

    const dragHandle = card.querySelector(".link-drag");
    attachDragHandlers(card, link.id, dragHandle);

    elements.linksList.appendChild(card);

    // If layout panel is open for this link, insert it after the card
    if (isLayoutOpen) {
      const layoutPanel = createLayoutPanel(link);
      elements.linksList.appendChild(layoutPanel);
    }
  });
}

function renderPreview() {
  if (!elements.previewLinks) return;
  elements.previewLinks.innerHTML = "";
  setInboxSheetOpen(false);
  if (elements.previewInboxBanner) {
    elements.previewInboxBanner.className = "phone-bottom-banner";
    elements.previewInboxBanner.innerHTML = "";
  }
  if (elements.previewCta) {
    elements.previewCta.style.display = elements.footerSwitch && !elements.footerSwitch.checked ? "none" : "block";
  }
}

function openModal(id = null) {
  editingId = id;
  const isEdit = Boolean(id);
  const link = links.find((item) => item.id === id);
  if (link?.locked) {
    editingId = null;
    return;
  }
  elements.modalTitle.textContent = isEdit ? "Edit box" : "Add box";
  elements.linkForm.reset();
  if (elements.linkHasUrlToggle) {
    elements.linkHasUrlToggle.checked = link
      ? Boolean(typeof link.hasUrl === "boolean" ? link.hasUrl : link.url)
      : true;
  }
  if (link) {
    elements.linkForm.title.value = link.title;
    elements.linkForm.url.value = link.url;
  }
  updateLinkUrlVisibility();
  elements.linkModal.classList.add("is-open");
}

function openLinkModal() {
  editingId = null;
  elements.modalTitle.textContent = "Add link";
  elements.linkForm.reset();
  if (elements.linkHasUrlToggle) {
    elements.linkHasUrlToggle.checked = true;
  }
  updateLinkUrlVisibility();
  elements.linkModal.classList.add("is-open");
}

function closeModal() {
  elements.linkModal.classList.remove("is-open");
}

function updateLinkUrlVisibility() {
  if (!elements.linkHasUrlToggle) return;
  const shouldShow = Boolean(elements.linkHasUrlToggle.checked);
  if (elements.linkUrlField) {
    elements.linkUrlField.hidden = !shouldShow;
  }
  if (elements.linkUrl) {
    elements.linkUrl.disabled = !shouldShow;
    elements.linkUrl.required = shouldShow;
  }
}

function openProfileModal() {
  elements.profileNameInput.value = profile.name;
  elements.profileUsernameInput.value = profile.username || "";
  elements.profileMetaInput.value = profile.bio;
  const profileIsLocal = appearance.profileImageUrl?.startsWith("data:");
  setImageHint(
    elements.profileImageHint,
    profileIsLocal ? "Using local file (stored in browser)." : "Supports JPG, PNG, WebP."
  );
  if (elements.showProfileImage) elements.showProfileImage.checked = visibility.showProfileImage;
  if (elements.showDisplayName) elements.showDisplayName.checked = visibility.showDisplayName;
  if (elements.showBio) elements.showBio.checked = visibility.showBio;
  if (elements.showSocialIcons) elements.showSocialIcons.checked = visibility.showSocialIcons;
  elements.profileModal.classList.add("is-open");
  elements.profileModal.setAttribute("aria-hidden", "false");
}

function closeProfileModal() {
  elements.profileModal.classList.remove("is-open");
  elements.profileModal.setAttribute("aria-hidden", "true");
}

async function downloadPreviewImage() {
  const phone = document.querySelector(".phone");
  if (!phone) return;
  if (typeof html2canvas !== "function") {
    alert("Download not ready. Please refresh the page and try again.");
    return;
  }
  const btn = elements.downloadPreviewBtn;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-loading");
  }
  try {
    const bgColor = appearance.backgroundColor || "#ffffff";
    const canvas = await html2canvas(phone, {
      backgroundColor: bgColor,
      useCORS: true,
      scale: 2,
    });
    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve();
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "openme-preview.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        resolve();
      }, "image/png");
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  }
}

function initEvents() {
  const isMobileAd = () => window.matchMedia("(max-width: 1024px), (hover: none), (pointer: coarse)").matches;
  if (elements.adPanel && elements.appShell) {
    const syncAdPanelState = () => {
      const mobile = isMobileAd();
      if (mobile) {
        elements.adPanel.classList.remove("is-hidden", "is-collapsed");
        elements.adPanel.classList.add("is-expanded");
        elements.appShell.classList.remove("is-ad-dismissed");
      } else {
        elements.adPanel.classList.remove("is-collapsed", "is-expanded", "is-hidden");
        elements.appShell.classList.remove("is-ad-dismissed");
      }
    };
    syncAdPanelState();
    window.addEventListener("resize", syncAdPanelState);
  }
  const toggleAdCollapse = () => {
    if (!isMobileAd() || !elements.adPanel) return;
    const willExpand = elements.adPanel.classList.contains("is-collapsed");
    elements.adPanel.classList.toggle("is-collapsed", !willExpand);
    elements.adPanel.classList.toggle("is-expanded", willExpand);
    sessionStorage.setItem("openme_ad_collapsed", String(!willExpand));
  };
  if (elements.adPanelClose && elements.adPanel) {
    elements.adPanelClose.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAdCollapse();
    });
  }
  const adSheetHandle = document.getElementById("adSheetHandle");
  if (adSheetHandle) {
    adSheetHandle.addEventListener("click", toggleAdCollapse);
  }
  const setAdContactSheetOpen = (value) => {
    elements.adContactSheet?.classList.toggle("is-open", value);
    elements.adContactBackdrop?.classList.toggle("is-open", value);
    elements.adContactSheet?.setAttribute("aria-hidden", String(!value));
    elements.adContactBackdrop?.setAttribute("aria-hidden", String(!value));
    if (value) {
      window.setTimeout(() => elements.adContactEmail?.focus(), 120);
    }
  };
  if (elements.adContactTrigger) {
    elements.adContactTrigger.addEventListener("click", () => setAdContactSheetOpen(true));
  }
  if (elements.adContactClose) {
    elements.adContactClose.addEventListener("click", () => setAdContactSheetOpen(false));
  }
  if (elements.adContactBackdrop) {
    elements.adContactBackdrop.addEventListener("click", () => setAdContactSheetOpen(false));
  }
  if (elements.adContactForm) {
    elements.adContactForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = elements.adContactEmail?.value.trim() || "";
      const message = elements.adContactMessage?.value.trim() || "";
      const subject = encodeURIComponent("OP4N.ME contact");
      const body = encodeURIComponent(`Email: ${email}\n\nMessage:\n${message}`);
      if (elements.adContactNote) {
        elements.adContactNote.textContent = "Opening your email app...";
      }
      window.location.href = `mailto:kwanchanok.phon@gmail.com?subject=${subject}&body=${body}`;
    });
  }
  if (elements.addLinkFeatureBtn) {
    elements.addLinkFeatureBtn.addEventListener("click", openLinkModal);
  }
  if (elements.addLinkBtn) {
    elements.addLinkBtn.addEventListener("click", () => openModal());
  }
  if (elements.topbarAddBtn) {
    elements.topbarAddBtn.addEventListener("click", () => {
      const linkTitle = document.getElementById("linkTitle");
      if (linkTitle) {
        linkTitle.focus({ preventScroll: true });
        linkTitle.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  if (elements.downloadPreviewBtn) {
    elements.downloadPreviewBtn.addEventListener("click", downloadPreviewImage);
  }
  if (elements.sidebarToggle && elements.sidebar && elements.sidebarOverlay) {
    const openSidebar = () => {
      elements.sidebar.classList.add("is-open");
      elements.sidebarOverlay.classList.add("is-visible");
    };
    const closeSidebar = () => {
      elements.sidebar.classList.remove("is-open");
      elements.sidebarOverlay.classList.remove("is-visible");
    };

    elements.sidebarToggle.addEventListener("click", () => {
      if (elements.sidebar.classList.contains("is-open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
    elements.sidebarOverlay.addEventListener("click", closeSidebar);
  }
  if (elements.sidebarAddBtn) {
    elements.sidebarAddBtn.addEventListener("click", () => openModal());
  }
  if (elements.closeModalBtn) {
    elements.closeModalBtn.addEventListener("click", closeModal);
  }
  if (elements.linkModal) {
    elements.linkModal.addEventListener("click", (event) => {
      if (event.target === elements.linkModal) closeModal();
    });
  }

  elements.linkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (editingId && links.find((item) => item.id === editingId)?.locked) {
      editingId = null;
      closeModal();
      return;
    }
    const formData = new FormData(elements.linkForm);
    const urlValue = String(formData.get("url") || "").trim();
    const hasUrl = Boolean(urlValue);
    const linkData = {
      id: editingId || crypto.randomUUID(),
      title: formData.get("title"),
      hasUrl,
      url: urlValue,
      shortCode: editingId
        ? links.find((item) => item.id === editingId)?.shortCode || createShortCode()
        : createShortCode(),
      thumbnail: editingId ? links.find((item) => item.id === editingId)?.thumbnail || "" : "",
      featured: false,
      enabled: true,
    };

    if (editingId) {
      const index = links.findIndex((item) => item.id === editingId);
      if (index > -1) links[index] = { ...links[index], ...linkData };
    } else {
      links.unshift(linkData);
      activeLinkFilter = "created";
    }

    editingId = null;
    saveAll();
    renderLinks();
    renderPreview();
  });

  if (elements.linkHasUrlToggle) {
    elements.linkHasUrlToggle.addEventListener("change", updateLinkUrlVisibility);
  }

  if (elements.inboxLayoutBtn) {
    elements.inboxLayoutBtn.addEventListener("click", () => {
      setInboxOpen(!inboxOpen);
    });
  }

  if (elements.inboxCloseBtn) {
    elements.inboxCloseBtn.addEventListener("click", () => {
      setInboxOpen(false);
    });
  }

  if (elements.inboxSection) {
    elements.inboxSection.querySelectorAll("[data-inbox-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setInboxTab(btn.dataset.inboxTab);
      });
    });
  }

  if (elements.inboxSwitch) {
    elements.inboxSwitch.addEventListener("change", renderPreview);
  }

  if (elements.bannerAddBtn) {
    elements.bannerAddBtn.addEventListener("click", () => openBannerModal());
  }
  if (elements.closeBannerBtn) {
    elements.closeBannerBtn.addEventListener("click", closeBannerModal);
  }
  if (elements.bannerModal) {
    elements.bannerModal.addEventListener("click", (event) => {
      if (event.target === elements.bannerModal) closeBannerModal();
    });
  }
  if (elements.bannerPriceToggle) {
    elements.bannerPriceToggle.addEventListener("change", updateBannerPriceVisibility);
  }
  if (elements.bannerHasLinkToggle) {
    elements.bannerHasLinkToggle.addEventListener("change", updateBannerLinkVisibility);
  }
  if (elements.bannerImagePickBtn && elements.bannerImageInput) {
    elements.bannerImagePickBtn.addEventListener("click", () => {
      elements.bannerImageInput.click();
    });
    elements.bannerImageInput.addEventListener("change", () => {
      const file = elements.bannerImageInput.files?.[0];
      if (!file) return;
      openCropModal({
        file,
        title: "Crop banner image",
        aspectRatio: 1,
        onSave: (dataUrl) => {
          bannerDraftImage = dataUrl;
          updateBannerModalImageUI();
        },
      });
    });
  }
  if (elements.bannerImageResetBtn) {
    elements.bannerImageResetBtn.addEventListener("click", () => {
      bannerDraftImage = "";
      if (elements.bannerImageInput) elements.bannerImageInput.value = "";
      updateBannerModalImageUI();
    });
  }
  if (elements.bannerSwitch) {
    elements.bannerSwitch.addEventListener("change", () => {
      if (elements.bannerSwitch.checked && !isBannerReady()) {
        bannerEnabled = false;
        elements.bannerSwitch.checked = false;
        updateBannerRequirementState();
        return;
      }
      bannerEnabled = elements.bannerSwitch.checked;
      saveAll();
      renderPreview();
    });
  }
  if (elements.bannerForm) {
    elements.bannerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const hasLink = Boolean(elements.bannerHasLinkToggle?.checked);
      const url = hasLink ? (elements.bannerLinkUrl?.value.trim() || "") : "";
      const showPrice = Boolean(elements.bannerPriceToggle?.checked);
      const price = elements.bannerPriceValue?.value.trim() || "";
      const unit = elements.bannerPriceUnit?.value.trim() || "";
      if (!bannerDraftImage || (hasLink && !url)) return;

      const payload = {
        id: editingBannerId || crypto.randomUUID(),
        image: bannerDraftImage,
        hasLink,
        url,
        showPrice,
        price: showPrice ? price : "",
        unit: showPrice ? unit : "",
      };

      if (editingBannerId) {
        const index = bannerItems.findIndex((item) => item.id === editingBannerId);
        if (index > -1) bannerItems[index] = payload;
      } else {
        bannerItems.push(payload);
      }

      saveAll();
      renderBannerItems();
      renderPreview();
      closeBannerModal();
    });
  }

  if (elements.inboxEditBtn && elements.inboxTitle) {
    elements.inboxEditBtn.addEventListener("click", () => {
      const current = inboxName;
      const input = document.createElement("input");
      input.type = "text";
      input.value = current;
      input.className = "inbox-title-input";
      elements.inboxTitle.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const next = input.value.trim() || "Get in touch";
        inboxName = next;
        saveAll();
        const span = document.createElement("span");
        span.className = "link-title";
        span.id = "inboxTitle";
        span.textContent = inboxName;
        input.replaceWith(span);
        elements.inboxTitle = span;
        if (elements.previewInboxSheetTitle) {
          elements.previewInboxSheetTitle.textContent = inboxName;
        }
        renderPreview();
      };

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          input.value = current;
          input.blur();
        }
      });
    });
  }

  if (elements.inboxEditFormBtn) {
    elements.inboxEditFormBtn.addEventListener("click", openInboxFormModal);
  }
  if (elements.inboxAddFieldBtn) {
    elements.inboxAddFieldBtn.addEventListener("click", openInboxFieldLibraryModal);
  }
  if (elements.closeInboxFormBtn) {
    elements.closeInboxFormBtn.addEventListener("click", closeAllInboxFormModals);
  }
  if (elements.dismissInboxFormBtn) {
    elements.dismissInboxFormBtn.addEventListener("click", closeAllInboxFormModals);
  }
  if (elements.inboxFormDoneBtn) {
    elements.inboxFormDoneBtn.addEventListener("click", closeAllInboxFormModals);
  }
  if (elements.inboxFieldLibraryBackBtn) {
    elements.inboxFieldLibraryBackBtn.addEventListener("click", () => {
      closeSimpleModal(elements.inboxFieldLibraryModal);
      openInboxFormModal();
    });
  }
  if (elements.dismissInboxFieldLibraryBtn) {
    elements.dismissInboxFieldLibraryBtn.addEventListener("click", closeAllInboxFormModals);
  }
  if (elements.inboxFieldConfigBackBtn) {
    elements.inboxFieldConfigBackBtn.addEventListener("click", () => {
      closeSimpleModal(elements.inboxFieldConfigModal);
      openInboxFieldLibraryModal();
    });
  }
  if (elements.dismissInboxFieldConfigBtn) {
    elements.dismissInboxFieldConfigBtn.addEventListener("click", closeAllInboxFormModals);
  }
  if (elements.inboxFieldSearchInput) {
    elements.inboxFieldSearchInput.addEventListener("input", () => {
      renderInboxFieldLibrary(elements.inboxFieldSearchInput.value);
    });
  }
  if (elements.inboxFieldTypeSelect) {
    elements.inboxFieldTypeSelect.addEventListener("change", () => {
      preferredFieldType = elements.inboxFieldTypeSelect.value;
      if (!isChoiceType(preferredFieldType)) {
        draftChoiceOptions = [];
      } else if (!draftChoiceOptions.length) {
        draftChoiceOptions = ["Option 1", "Option 2"];
      }
      renderChoiceInputs();
      if (elements.inboxFieldLabelInput && !elements.inboxFieldLabelInput.value.trim()) {
        elements.inboxFieldLabelInput.value = prettyFieldType(preferredFieldType);
      }
    });
  }
  if (elements.inboxAddChoiceBtn) {
    elements.inboxAddChoiceBtn.addEventListener("click", () => {
      draftChoiceOptions.push(`Option ${draftChoiceOptions.length + 1}`);
      renderChoiceInputs();
    });
  }
  if (elements.inboxFieldConfigForm) {
    elements.inboxFieldConfigForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const type = elements.inboxFieldTypeSelect?.value || "text";
      const rawLabel = elements.inboxFieldLabelInput?.value || "";
      const label = rawLabel.trim() || prettyFieldType(type);
      const isRequired = Boolean(elements.inboxFieldRequiredInput?.checked);
      const choices = isChoiceType(type)
        ? normalizeChoices(draftChoiceOptions)
        : [];
      if (isChoiceType(type) && choices.length === 0) {
        return;
      }

      const newField = {
        id: crypto.randomUUID(),
        type,
        label,
        required: isRequired,
        choices,
      };
      inboxFormFields.push(newField);
      saveAll();
      renderInboxFormEditor();
      renderPreviewInboxForm();
      closeSimpleModal(elements.inboxFieldConfigModal);
      openInboxFormModal();
    });
  }

  [elements.inboxFormModal, elements.inboxFieldLibraryModal, elements.inboxFieldConfigModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeAllInboxFormModals();
    });
  });

  if (elements.previewInboxSheetClose) {
    elements.previewInboxSheetClose.addEventListener("click", () => setInboxSheetOpen(false));
  }
  if (elements.previewInboxSheetBackdrop) {
    elements.previewInboxSheetBackdrop.addEventListener("click", () => setInboxSheetOpen(false));
  }

  if (elements.previewInboxSheetTitle) {
    elements.previewInboxSheetTitle.textContent = inboxName;
  }

  if (elements.footerSwitch) elements.footerSwitch.addEventListener("change", () => {
    elements.footerSwitch.checked = true;
    if (elements.footerUpgradeTip) {
      elements.footerUpgradeTip.classList.add("is-visible");
      clearTimeout(elements.footerUpgradeTip._hideTimer);
      elements.footerUpgradeTip._hideTimer = setTimeout(() => {
        elements.footerUpgradeTip.classList.remove("is-visible");
      }, 1600);
    }
    renderPreview();
  });

  if (elements.editProfileBtn) elements.editProfileBtn.addEventListener("click", openProfileModal);
  elements.closeProfileBtn.addEventListener("click", closeProfileModal);
  elements.profileModal.addEventListener("click", (event) => {
    if (event.target === elements.profileModal) closeProfileModal();
  });

  elements.profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    profile.name = elements.profileNameInput.value.trim();
    profile.username = elements.profileUsernameInput.value.trim();
    profile.bio = elements.profileMetaInput.value.trim();
    saveAll();
    renderProfile();
    applyAppearance();
    closeProfileModal();
  });

  document.querySelectorAll(".social-slot").forEach((slot) => {
    slot.addEventListener("click", () => openSocialModal(slot));
  });

  elements.closeSocialBtn.addEventListener("click", closeSocialModal);
  elements.socialModal.addEventListener("click", (event) => {
    if (event.target === elements.socialModal) closeSocialModal();
  });

  elements.socialForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!activeSocialSlot) return;
    const url = elements.socialUrl.value.trim();
    socialLinks[activeSocialSlot.dataset.platform] = url;
    saveAll();
    renderSocialSlots();
    closeSocialModal();
  });

  if (elements.openDesignBtn) {
    elements.openDesignBtn.addEventListener("click", openDesignModal);
  }
  if (elements.closeDesignBtn) {
    elements.closeDesignBtn.addEventListener("click", closeDesignModal);
  }
  if (elements.designModal) {
    elements.designModal.addEventListener("click", (event) => {
      if (event.target === elements.designModal) closeDesignModal();
    });
  }
  elements.cropModal.addEventListener("click", (event) => {
    if (event.target === elements.cropModal) closeCropModal();
  });
  elements.closeCropBtn.addEventListener("click", closeCropModal);
  elements.cropCancelBtn.addEventListener("click", closeCropModal);
  elements.cropSaveBtn.addEventListener("click", saveCrop);

  // Sidebar is always visible — toggle disabled

  if (elements.showProfileImage) {
    elements.showProfileImage.addEventListener("change", () => {
      visibility.showProfileImage = elements.showProfileImage.checked;
      saveAll();
      applyAppearance();
    });
  }

  if (elements.showDisplayName) {
    elements.showDisplayName.addEventListener("change", () => {
      visibility.showDisplayName = elements.showDisplayName.checked;
      saveAll();
      renderProfile();
    });
  }

  if (elements.showBio) {
    elements.showBio.addEventListener("change", () => {
      visibility.showBio = elements.showBio.checked;
      saveAll();
      renderProfile();
    });
  }
  if (elements.showSocialIcons) {
    elements.showSocialIcons.addEventListener("change", () => {
      visibility.showSocialIcons = elements.showSocialIcons.checked;
      saveAll();
      renderProfile();
    });
  }

  elements.designForm.addEventListener("submit", (event) => {
    event.preventDefault();
    appearance.backgroundColor = elements.backgroundColor.value.trim();
    appearance.buttonColor = elements.buttonColor.value.trim();
    appearance.profileFontColor = elements.profileFontColor.value.trim();
    appearance.buttonFontColor = elements.buttonFontColor.value.trim();
    saveAll();
    applyAppearance();
    closeDesignModal();
  });

  elements.resetDesignBtn.addEventListener("click", resetAppearance);

  if (elements.profileImageFile) {
    elements.profileImageFile.addEventListener("change", () => {
      const file = elements.profileImageFile.files?.[0];
      if (!file) return;
      openCropModal({
        file,
        title: "Crop profile image",
        aspectRatio: CROP_RATIOS.profile,
        onSave: (dataUrl) => {
          appearance.profileImageUrl = dataUrl;
          saveAll();
          applyAppearance();
          setImageHint(elements.profileImageHint, "Using local file (stored in browser).");
        },
      });
    });
  }

  if (elements.backgroundImageFile) {
    elements.backgroundImageFile.addEventListener("change", () => {
      const file = elements.backgroundImageFile.files?.[0];
      if (!file) return;
      openCropModal({
        file,
        title: "Crop background image",
        aspectRatio: CROP_RATIOS.background,
        onSave: (dataUrl) => {
          appearance.backgroundImageUrl = dataUrl;
          saveAll();
          applyAppearance();
          setImageHint(elements.backgroundImageHint, "Using local file (stored in browser).");
        },
      });
    });
  }

  const wireColorPicker = (picker, input) => {
    if (!picker || !input) return;
    picker.addEventListener("input", () => {
      input.value = picker.value;
      input.dispatchEvent(new Event("input"));
    });
    input.addEventListener("input", () => {
      const value = input.value.trim();
      if (/^#([0-9a-fA-F]{6})$/.test(value)) {
        picker.value = value;
      }
    });
  };

  wireColorPicker(elements.backgroundColorPicker, elements.backgroundColor);
  wireColorPicker(elements.buttonColorPicker, elements.buttonColor);
  wireColorPicker(elements.profileFontColorPicker, elements.profileFontColor);
  wireColorPicker(elements.buttonFontColorPicker, elements.buttonFontColor);

  setInboxOpen(inboxOpen);
  setInboxTab(inboxTab);
  renderInboxBanner();
  renderBannerItems();
  renderPreviewBannerMarquee();
}

function initNavAccordion() {
  document.querySelectorAll(".nav-title").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".nav-section");
      if (!section) return;
      section.classList.toggle("is-collapsed");
    });
  });
}

function initBannerCycle() {
  const messages = [
    "OP4N.COM",
    "OP4N.ME/MAKE LINKS SHARABLE",
    "OP4N.ME/MAKE THEM OPEN YOURS",
    "OPEN FOR BESPOKE LINK DESIGN",
  ];
  const el = elements.bannerText;
  if (!el) return;
  let index = 0;
  el.textContent = messages[0];
  el.style.animation = "none";
  setInterval(() => {
    el.style.animation = "banner-slide-up-out 0.4s ease forwards";
    setTimeout(() => {
      index = (index + 1) % messages.length;
      el.textContent = messages[index];
      el.style.animation = "banner-slide-up-in 0.4s ease forwards";
    }, 420);
  }, 2000);
}

function initTopbarTypewriter() {
  const el = elements.topbarPromptText;
  if (!el) return;

  const phrases = [
    "Paste Your Link And Get Shareable One",
  ];
  const typeDelay = 70;
  const deleteDelay = 40;
  const holdDelay = 1200;
  const resetDelay = 400;
  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;

  const tick = () => {
    const phrase = phrases[phraseIndex];
    el.textContent = phrase.slice(0, charIndex);
    if (elements.topbarAddBtn) {
      elements.topbarAddBtn.setAttribute("aria-label", `Create link: ${phrase}`);
    }

    if (!isDeleting && charIndex < phrase.length) {
      charIndex += 1;
      setTimeout(tick, typeDelay);
      return;
    }

    if (!isDeleting) {
      isDeleting = true;
      setTimeout(tick, holdDelay);
      return;
    }

    if (charIndex > 0) {
      charIndex -= 1;
      setTimeout(tick, deleteDelay);
      return;
    }

    isDeleting = false;
    phraseIndex = (phraseIndex + 1) % phrases.length;
    setTimeout(tick, resetDelay);
  };

  el.textContent = "";
  tick();
}

function initAdYouWord() {
  const el = elements.adYouWord;
  if (!el) return;

  const words = [
    "YOU",
    "คุณ",
    "你",
    "당신",
    "あなた",
    "тебя",
    "tú",
    "te",
    "toi",
    "ʻoe",
  ];
  let index = 0;

  window.setInterval(() => {
    el.classList.add("is-exiting");
    window.setTimeout(() => {
      index = (index + 1) % words.length;
      el.textContent = words[index];
      el.classList.remove("is-exiting");
      el.classList.add("is-entering");
      void el.offsetHeight;
      el.classList.remove("is-entering");
    }, 350);
  }, 2000);
}

function init() {
  if (FORCE_PROFILE_MOCK) {
    setStorageValue("profile", defaultProfile);
  }
  if (FORCE_APPEARANCE_MOCK) {
    setStorageValue("appearance", defaultAppearance);
  }
  renderProfile();
  renderLinks();
  renderPreview();
  initEvents();
  renderSocialSlots();
  applyAppearance();
  initNavAccordion();
  initBannerCycle();
  initTopbarTypewriter();
  initAdYouWord();
  if (FORCE_PROFILE_MOCK) {
    openProfileModal();
  }
}

init();
