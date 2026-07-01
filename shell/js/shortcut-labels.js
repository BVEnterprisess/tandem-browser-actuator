(() => {
  const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

  function getCommandOrControlLabel(platform) {
    return platform === 'darwin' ? 'Cmd' : 'Ctrl';
  }

  function labelShortcutText(text, platform) {
    const modifier = getCommandOrControlLabel(platform);
    let labelled = text
      .replace(/CommandOrControl\+/gi, `${modifier}+`)
      .replace(/CmdOrCtrl\+/gi, `${modifier}+`)
      .replace(/Command\+/gi, `${modifier}+`)
      .replace(/Cmd\+/gi, `${modifier}+`);

    if (platform !== 'darwin') {
      labelled = labelled
        .replace(/⌘⇧/g, `${modifier}+Shift+`)
        .replace(/⌘/g, `${modifier}+`);
    }

    return labelled;
  }

  async function detectPlatform() {
    if (window.tandem?.getPlatform) {
      try {
        return await window.tandem.getPlatform();
      } catch {
        // Fall through to browser-provided hints.
      }
    }

    const userAgentPlatform = navigator.userAgentData?.platform || navigator.platform || '';
    return /mac/i.test(userAgentPlatform) ? 'darwin' : 'win32';
  }

  function applyShortcutLabels(root, platform) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TEXT_TAGS.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return /Cmd\+|CommandOrControl\+|CmdOrCtrl\+|Command\+|⌘/.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
      node.nodeValue = labelShortcutText(node.nodeValue || '', platform);
    }

    for (const element of root.querySelectorAll('[title]')) {
      const title = element.getAttribute('title') || '';
      element.setAttribute('title', labelShortcutText(title, platform));
    }
  }

  async function initShortcutLabels() {
    const platform = await detectPlatform();
    applyShortcutLabels(document.body, platform);
  }

  window.tandemShortcutLabels = {
    applyShortcutLabels,
    detectPlatform,
    getCommandOrControlLabel,
    labelShortcutText,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initShortcutLabels();
    }, { once: true });
  } else {
    void initShortcutLabels();
  }
})();
