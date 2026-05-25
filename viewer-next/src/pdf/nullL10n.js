class GenericL10n {
  constructor(lang = "en-us") {
    this.lang = lang;
  }

  getLanguage() {
    return this.lang;
  }

  getDirection() {
    return "ltr";
  }

  async get(ids, _args = null, fallback = "") {
    if (Array.isArray(ids)) {
      return ids.map(item => item.fallback || fallback);
    }
    return fallback;
  }

  async translate() {}

  async translateOnce() {}

  async destroy() {}

  pause() {}

  resume() {}
}

export { GenericL10n };
