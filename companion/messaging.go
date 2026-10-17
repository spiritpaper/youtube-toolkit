package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

// Chrome's native messaging framing: a 4-byte length in native byte order
// (little-endian on every platform Chrome supports), then UTF-8 JSON.
const maxIncoming = 1 << 20 // Chrome sends at most 64 MiB; we never need more than this

func readMessage(r io.Reader, v any) error {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return err
	}
	if n > maxIncoming {
		return fmt.Errorf("message too large (%d bytes)", n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	return json.Unmarshal(buf, v)
}

type writer struct {
	mu sync.Mutex
	w  io.Writer
}

func (w *writer) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(b) > 1<<20 {
		return errors.New("reply too large")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := binary.Write(w.w, binary.LittleEndian, uint32(len(b))); err != nil {
		return err
	}
	_, err = w.w.Write(b)
	return err
}
