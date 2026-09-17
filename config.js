window.SUPABASE_CONFIG = {
  brandName: "LittleAPI",
  brandDomain: "https://littleapi.online",
  url: "https://dnwaapropjmoyqxquzvs.supabase.co",
  publishableKey: "sb_publishable_Yik47TNnUdzBHy-S0WMM4w_v_YkWMKP",
  googleClientId: "934959548251-9ismqh887fueuja0ji0745cp4tmh5i4n.apps.googleusercontent.com",
  apiBase: "https://littleapi.online/api/v1"
};

(() => {
  const brandIcon = `
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5.5" width="14" height="21" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M3.5 11h14M3.5 17h14M9 5.5v21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="m23 10-3.5 6 3.5 6M27 10l3.5 6-3.5 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const applyBrandIcon = () => {
    document.querySelectorAll('.brand-mark').forEach(node => {
      if (node.dataset.littleapiIcon === 'data-code') return;
      node.innerHTML = brandIcon;
      node.dataset.littleapiIcon = 'data-code';
      node.setAttribute('aria-hidden', 'true');
    });
  };

  const loadLandingUpgrades = () => {
    applyBrandIcon();
    const home = document.querySelector('#public-home');
    if (!home || document.querySelector('script[data-littleapi-landing-upgrades]')) return;
    const syncVisibility = () => {
      const section = document.querySelector('#littleapi-modern-features');
      if (section) section.classList.toggle('hidden', home.classList.contains('hidden'));
    };
    const script = document.createElement('script');
    script.src = 'landing-upgrades.js?v=20260917-3';
    script.dataset.littleapiLandingUpgrades = 'true';
    script.onload = () => {
      syncVisibility();
      new MutationObserver(syncVisibility).observe(home, { attributes:true, attributeFilter:['class'] });
    };
    document.body.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLandingUpgrades, { once:true });
  else loadLandingUpgrades();
})();
