// YT Toolkit companion: an optional helper that lets the YT Toolkit browser
// extension download videos. Chrome starts it as a "native messaging host";
// run it yourself once to install it:
//
//	yt-toolkit-companion                 interactive install (asks for the extension ID)
//	yt-toolkit-companion install --extension-id ID [--extension-id ID2]
//	yt-toolkit-companion update          get the latest downloader
//	yt-toolkit-companion uninstall
//	yt-toolkit-companion version
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// Version is set at build time (-ldflags "-X main.Version=...").
var Version = "dev"

func main() {
	args := os.Args[1:]
	// Chrome starts the host with the calling extension's origin as an argument.
	for _, a := range args {
		if strings.HasPrefix(a, "chrome-extension://") {
			if err := serve(os.Stdin, os.Stdout); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			return
		}
	}
	cmd := "install"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "install":
		err = runInstall(args)
	case "update":
		var v string
		v, err = updateDownloader(installDir())
		if err == nil {
			fmt.Println("Downloader is up to date:", v)
		}
	case "uninstall":
		err = uninstall()
	case "version", "--version", "-v":
		fmt.Println("yt-toolkit-companion", Version)
	default:
		fmt.Fprintf(os.Stderr, "Unknown command %q. Use install, update, uninstall or version.\n", cmd)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
	}
	pauseIfDoubleClicked()
	if err != nil {
		os.Exit(1)
	}
}

type idList []string

func (l *idList) String() string     { return strings.Join(*l, ",") }
func (l *idList) Set(v string) error { *l = append(*l, strings.Split(v, ",")...); return nil }

func runInstall(args []string) error {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	var ids idList
	fs.Var(&ids, "extension-id", "YT Toolkit's extension ID (Settings → Video downloads); repeat for several")
	folder := fs.String("downloads", "", "where downloads go (default: your Downloads folder, \"YT Toolkit\")")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if len(ids) == 0 {
		fmt.Println("YT Toolkit companion " + Version + " (video downloads add-on)")
		fmt.Println()
		fmt.Println("Open YT Toolkit → Settings → Video downloads and copy the extension ID.")
		fmt.Print("Paste it here and press Enter: ")
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		ids = append(ids, strings.Fields(strings.ReplaceAll(line, ",", " "))...)
	}
	return install(ids, *folder)
}

// On Windows a double-clicked console window closes immediately; keep it open.
func pauseIfDoubleClicked() {
	if runtime.GOOS == "windows" && len(os.Args) == 1 {
		fmt.Print("\nPress Enter to close.")
		bufio.NewReader(os.Stdin).ReadString('\n')
	}
}
