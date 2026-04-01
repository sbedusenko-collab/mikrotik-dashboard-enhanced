function previewDestructive({ action, dry_run, confirm, preview }) {
  if (dry_run === true || confirm !== true) {
    return `Preview: ${preview}. Re-run with confirm=true to apply ${action}.`;
  }
  return null;
}

module.exports = { previewDestructive };
