// Where the extension looks for new releases. The public build checks the
// GitHub releases of spiritpaper/youtube-toolkit; a build that is updated
// another way (a script that copies new files into its folder) sets this to
// null and relies on the self-reload alone.
export const RELEASES_API = 'https://api.github.com/repos/spiritpaper/youtube-toolkit/releases/latest';
export const RELEASES_PAGE = 'https://github.com/spiritpaper/youtube-toolkit/releases/latest';
