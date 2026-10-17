// Where the extension looks for new releases. The public build checks the
// GitHub releases of spiritpaper/outlier-lab; a build that is updated
// another way (a script that copies new files into its folder) sets this to
// null and relies on the self-reload alone.
export const RELEASES_API = 'https://api.github.com/repos/spiritpaper/outlier-lab/releases/latest';
export const RELEASES_PAGE = 'https://github.com/spiritpaper/outlier-lab/releases/latest';
