const ROAD_SIGN_ASSETS = {
  I25: {
    src: "/dashboard/I-25.svg?v=sign-normalized-1",
    label: "Interstate 25 road sign",
    x: "0%",
    scaleX: 1.34,
    scaleY: 1.34
  },
  I70: {
    src: "/dashboard/I-70.svg?v=sign-normalized-1",
    label: "Interstate 70 road sign",
    x: "5.3%",
    scaleX: 1.47,
    scaleY: 1.34
  }
};

class RoadSignDisplay extends HTMLElement {
  static get observedAttributes() {
    return ["corridor"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.currentSignKey = "";
    this.swapToken = 0;
    this.frameRequested = false;
    this.pendingPoint = {
      x: window.innerWidth * 0.56,
      y: window.innerHeight * 0.14
    };
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.renderReflection = this.renderReflection.bind(this);
  }

  connectedCallback() {
    if (!this.stage) {
      this.render();
    }

    window.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", this.handlePointerLeave);
    window.addEventListener("resize", this.handleResize);

    const corridor = this.getAttribute("corridor") || "I25";
    void this.setCorridor(corridor, { immediate: true, force: true });
    this.requestReflection(this.pendingPoint);
  }

  disconnectedCallback() {
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerleave", this.handlePointerLeave);
    window.removeEventListener("resize", this.handleResize);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== "corridor" || oldValue === newValue || !this.isConnected) {
      return;
    }
    void this.setCorridor(newValue);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: min(100%, 520px);
          aspect-ratio: 980 / 480;
        }

        .stage {
          --sheet-x: 0px;
          --sheet-y: 0px;
          --sheet-x-alt: 0px;
          --sheet-y-alt: 0px;
          --chroma-x: 50%;
          --chroma-y: 50%;
          --chroma-x-alt: 50%;
          --chroma-y-alt: 50%;
          --chroma-turn: 0deg;
          --chroma-opacity: 0.42;
          --glow-x: 52%;
          --glow-y: 34%;
          --surface-brightness: 0.98;
          --surface-contrast: 1.16;
          --surface-saturate: 1.1;
          --sign-image: url("/dashboard/I-25.svg?v=sign-normalized-1");
          --sign-art-x: 0%;
          --sign-art-scale-x: 1.34;
          --sign-art-scale-y: 1.34;
          position: relative;
          width: 100%;
          height: 100%;
          isolation: isolate;
        }

        .stage::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
          background:
            radial-gradient(ellipse 90% 68% at 50% 32%, rgba(255, 255, 255, 0.12), transparent 56%),
            repeating-linear-gradient(
              58deg,
              rgba(255, 255, 255, 0.018) 0 2px,
              rgba(255, 255, 255, 0.12) 2px 3px,
              rgba(0, 37, 30, 0.11) 3px 4px,
              transparent 4px 15px
            ),
            linear-gradient(145deg, rgba(0, 106, 84, 0.98), rgba(0, 91, 74, 0.98));
          opacity: 0;
          transform: translateX(var(--sign-art-x)) scale(var(--sign-art-scale-x), var(--sign-art-scale-y));
          transform-origin: center;
          transition: opacity 110ms ease;
          -webkit-mask: var(--sign-image) center / contain no-repeat;
          mask: var(--sign-image) center / contain no-repeat;
        }

        .stage.is-swapping::after {
          opacity: 1;
        }

        img {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter:
            contrast(var(--surface-contrast))
            saturate(var(--surface-saturate))
            brightness(var(--surface-brightness))
            drop-shadow(0 18px 28px rgba(23, 33, 38, 0.2));
          transform: translateX(var(--sign-art-x)) scale(var(--sign-art-scale-x), var(--sign-art-scale-y));
          transform-origin: center;
        }

        .sheet,
        .sheen {
          position: absolute;
          pointer-events: none;
          inset: 0;
          width: 100%;
          height: 100%;
          -webkit-mask: var(--sign-image) center / contain no-repeat;
          mask: var(--sign-image) center / contain no-repeat;
          transform: translateX(var(--sign-art-x)) scale(var(--sign-art-scale-x), var(--sign-art-scale-y));
          transform-origin: center;
        }

        .sheet {
          z-index: 2;
          background:
            repeating-linear-gradient(
              58deg,
              rgba(255, 255, 255, 0.02) 0 2px,
              rgba(255, 255, 255, 0.15) 2px 3px,
              rgba(0, 37, 30, 0.11) 3px 4px,
              transparent 4px 15px
            ),
            repeating-linear-gradient(
              122deg,
              rgba(255, 255, 255, 0.018) 0 3px,
              rgba(176, 255, 230, 0.1) 3px 4px,
              rgba(0, 29, 24, 0.1) 4px 6px,
              transparent 6px 18px
            ),
            linear-gradient(
              112deg,
              rgba(255, 255, 255, 0.06),
              transparent 36%,
              rgba(0, 0, 0, 0.12) 68%,
              rgba(255, 255, 255, 0.05)
            );
          background-position:
            var(--sheet-x) var(--sheet-y),
            var(--sheet-x-alt) var(--sheet-y-alt),
            0 0;
          opacity: 0.45;
          mix-blend-mode: soft-light;
        }

        .sheen {
          z-index: 3;
          background:
            radial-gradient(
              ellipse 86% 58% at var(--glow-x) var(--glow-y),
              rgba(255, 255, 255, 0.2) 0%,
              rgba(184, 255, 236, 0.12) 21%,
              transparent 56%
            ),
            conic-gradient(
              from var(--chroma-turn) at 50% 48%,
              rgba(255, 74, 209, 0.18) 0deg,
              rgba(255, 208, 92, 0.17) 62deg,
              rgba(94, 255, 115, 0.2) 126deg,
              rgba(48, 239, 255, 0.2) 188deg,
              rgba(132, 105, 255, 0.18) 252deg,
              rgba(255, 86, 177, 0.16) 314deg,
              rgba(255, 74, 209, 0.18) 360deg
            ),
            radial-gradient(
              ellipse 140% 118% at var(--chroma-x) var(--chroma-y),
              rgba(52, 255, 211, 0.18) 0%,
              rgba(79, 149, 255, 0.1) 32%,
              transparent 72%
            ),
            radial-gradient(
              ellipse 152% 128% at var(--chroma-x-alt) var(--chroma-y-alt),
              rgba(255, 116, 207, 0.15) 0%,
              rgba(255, 220, 99, 0.1) 35%,
              transparent 74%
            ),
            linear-gradient(
              104deg,
              transparent 0%,
              transparent 29%,
              rgba(255, 255, 255, 0.1) 43%,
              rgba(255, 255, 255, 0.23) 50%,
              rgba(100, 240, 255, 0.1) 59%,
              transparent 76%
            );
          background-size: 100% 100%, 310% 310%, 210% 210%, 235% 235%, 155% 155%;
          background-repeat: no-repeat;
          background-position:
            center,
            var(--chroma-x) var(--chroma-y),
            var(--chroma-x-alt) var(--chroma-y-alt),
            var(--chroma-y) var(--chroma-x-alt),
            center;
          opacity: var(--chroma-opacity);
          mix-blend-mode: screen;
          filter: blur(16px) saturate(2.35) contrast(1.04);
        }
      </style>
      <div id="stage" class="stage" role="img" aria-label="Interstate 25 road sign">
        <img id="image" src="/dashboard/I-25.svg?v=sign-normalized-1" alt="Interstate 25 road sign">
        <span class="sheet" aria-hidden="true"></span>
        <span class="sheen" aria-hidden="true"></span>
      </div>
    `;

    this.stage = this.shadowRoot.getElementById("stage");
    this.image = this.shadowRoot.getElementById("image");
  }

  async setCorridor(corridor, options = {}) {
    const signKey = this.normalizeCorridor(corridor);
    const sign = ROAD_SIGN_ASSETS[signKey];

    if (this.currentSignKey === signKey && !options.force) {
      return;
    }

    const applySign = () => {
      if (this.image) {
        this.image.src = sign.src;
        this.image.alt = sign.label;
      }
      if (this.stage) {
        this.stage.setAttribute("aria-label", sign.label);
        this.stage.style.setProperty("--sign-image", `url("${sign.src}")`);
        this.stage.style.setProperty("--sign-art-x", sign.x);
        this.stage.style.setProperty("--sign-art-scale-x", String(sign.scaleX));
        this.stage.style.setProperty("--sign-art-scale-y", String(sign.scaleY));
      }
      this.currentSignKey = signKey;
    };

    if (options.immediate || !this.image || !this.stage) {
      applySign();
      return;
    }

    const swapToken = ++this.swapToken;
    await this.preloadSign(sign.src);
    if (swapToken !== this.swapToken) {
      return;
    }

    this.stage.classList.add("is-swapping");
    await this.delay(120);
    if (swapToken !== this.swapToken) {
      return;
    }

    applySign();
    await this.nextFrame();
    await this.nextFrame();
    await this.delay(90);
    if (swapToken === this.swapToken) {
      this.stage.classList.remove("is-swapping");
    }
  }

  normalizeCorridor(corridor) {
    const normalizedCorridor = String(corridor || "").trim().toUpperCase();
    return ROAD_SIGN_ASSETS[normalizedCorridor] ? normalizedCorridor : "I25";
  }

  handlePointerMove(event) {
    this.requestReflection({ x: event.clientX, y: event.clientY });
  }

  handlePointerLeave() {
    this.requestReflection({
      x: window.innerWidth * 0.56,
      y: window.innerHeight * 0.14
    });
  }

  handleResize() {
    this.requestReflection(this.pendingPoint);
  }

  requestReflection(point) {
    this.pendingPoint = point;
    if (this.frameRequested) {
      return;
    }
    this.frameRequested = true;
    window.requestAnimationFrame(this.renderReflection);
  }

  renderReflection() {
    this.frameRequested = false;
    if (!this.stage) {
      return;
    }

    const originX = window.innerWidth * 0.5;
    const originY = 0;
    const nx = this.clamp((this.pendingPoint.x - originX) / Math.max(1, window.innerWidth * 0.52), -1, 1);
    const ny = this.clamp((this.pendingPoint.y - originY) / Math.max(1, window.innerHeight * 0.72), 0, 1);
    const roll = nx * 0.72 + (ny - 0.32) * 0.22;
    const lift = 1 - Math.min(1, Math.hypot(nx * 0.62, (ny - 0.18) * 0.35));

    const sheetX = nx * 20;
    const sheetY = ny * 16;
    const chromaX = 50 + (roll * 14);
    const chromaY = 48 + ((ny - 0.35) * 12);
    const chromaXAlt = 52 - (roll * 11);
    const chromaYAlt = 52 - ((ny - 0.25) * 10);
    const glowX = 52 + (nx * 7);
    const glowY = 33 + ((ny - 0.22) * 7);

    this.stage.style.setProperty("--sheet-x", `${sheetX.toFixed(2)}px`);
    this.stage.style.setProperty("--sheet-y", `${sheetY.toFixed(2)}px`);
    this.stage.style.setProperty("--sheet-x-alt", `${(-sheetX * 0.58).toFixed(2)}px`);
    this.stage.style.setProperty("--sheet-y-alt", `${(sheetY * 0.72).toFixed(2)}px`);
    this.stage.style.setProperty("--chroma-x", `${chromaX.toFixed(2)}%`);
    this.stage.style.setProperty("--chroma-y", `${chromaY.toFixed(2)}%`);
    this.stage.style.setProperty("--chroma-x-alt", `${chromaXAlt.toFixed(2)}%`);
    this.stage.style.setProperty("--chroma-y-alt", `${chromaYAlt.toFixed(2)}%`);
    this.stage.style.setProperty("--chroma-turn", `${(roll * 55).toFixed(2)}deg`);
    this.stage.style.setProperty("--glow-x", `${glowX.toFixed(2)}%`);
    this.stage.style.setProperty("--glow-y", `${glowY.toFixed(2)}%`);
    this.stage.style.setProperty("--chroma-opacity", (0.38 + lift * 0.1).toFixed(3));
    this.stage.style.setProperty("--surface-brightness", (0.965 + lift * 0.035).toFixed(3));
    this.stage.style.setProperty("--surface-contrast", (1.14 + lift * 0.055).toFixed(3));
    this.stage.style.setProperty("--surface-saturate", (1.08 + Math.abs(nx) * 0.08).toFixed(3));
  }

  preloadSign(src) {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (typeof image.decode !== "function") {
          resolve();
          return;
        }
        image.decode().catch(() => {}).then(resolve);
      };
      image.onerror = resolve;
      image.src = src;
    });
  }

  delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  nextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
}

if (!customElements.get("road-sign-display")) {
  customElements.define("road-sign-display", RoadSignDisplay);
}
