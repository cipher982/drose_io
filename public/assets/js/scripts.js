// Homepage: buttons marked data-pepper-open open Pepper's chat (pepper.js).
document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-pepper-open]");
    if (!trigger) return;
    if (window.PepperChat && typeof window.PepperChat.open === "function") {
        e.preventDefault();
        window.PepperChat.open();
    }
});

// Looping product videos (.loop-video): play only while on screen and someone
// is here (energy.js "active"), pause otherwise and resume where they were.
// With reduced motion, show a still frame and never play.
(() => {
    const videos = Array.from(document.querySelectorAll("video.loop-video"));
    if (!videos.length) return;
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) {
        videos.forEach((v) => { if (v.dataset.still) v.poster = v.dataset.still; });
        return;
    }
    const shown = (v) => v.offsetParent !== null; // hidden by the breakpoint rule
    // Fetch the visible layout's clip right away (about 100-150 KB) so it is
    // ready to play the moment it scrolls in. The hidden layout never loads.
    const warm = () => videos.forEach((v) => {
        if (shown(v) && v.preload !== "auto") { v.preload = "auto"; v.load(); }
    });
    warm();
    window.addEventListener("resize", warm);
    if (!("IntersectionObserver" in window)) return;
    const onScreen = new Set();
    let awake = true;
    const sync = (v) => {
        if (awake && onScreen.has(v) && shown(v)) {
            if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        } else if (!v.paused) {
            v.pause();
        }
    };
    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target);
            sync(e.target);
        });
    }, { threshold: 0.1 });
    videos.forEach((v) => io.observe(v));
    if (window.Energy) window.Energy.watch((level) => { awake = level === "active"; videos.forEach(sync); });
})();
