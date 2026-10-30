/* Ad setup. Everything you need to change is in ADS.
 *
 * 1. Get approved at adsense.google.com and paste your ca-pub-… id into client.
 * 2. Create a responsive display unit for each slot and paste its id below.
 * 3. Put your publisher line in ads.txt and set preview to false.
 *
 * With no client id, the slots show labelled outlines while preview is true,
 * and collapse completely when it is false. Live slots also collapse when an
 * ad blocker stops them or Google has no ad to show, so nobody sees a blank row.
 */
const ADS = {
  client: "",
  preview: false,
  slots: { leaderboard: "", midpage: "", footer: "" },
};

(function () {
  const boxes = [...document.querySelectorAll("[data-ad]")];
  const live = ADS.client && boxes.some(b => ADS.slots[b.dataset.ad]);

  const collapse = box => {
    box.innerHTML = "";
    box.classList.add("empty");
  };

  if (live) {
    const s = document.createElement("script");
    s.onerror = () => boxes.forEach(collapse);
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ADS.client);
    document.head.append(s);
  }

  for (const box of boxes) {
    const slot = ADS.slots[box.dataset.ad];
    if (live && slot) {
      const wrap = document.createElement("div");
      wrap.style.width = "100%";
      wrap.innerHTML = '<span class="ad-label">Advertisement</span>';
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.dataset.adClient = ADS.client;
      ins.dataset.adSlot = slot;
      ins.dataset.adFormat = "auto";
      ins.dataset.fullWidthResponsive = "true";
      wrap.append(ins);
      box.append(wrap);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      new MutationObserver(() => {
        if (ins.dataset.adStatus === "unfilled") collapse(box);
      }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
      // Some blockers let the script load and hide the ad instead.
      setTimeout(() => { if (!ins.offsetHeight) collapse(box); }, 5000);
    } else if (ADS.preview) {
      box.innerHTML = '<div class="ad-box">Advertisement</div>';
    } else {
      box.classList.add("empty");
    }
  }
})();
