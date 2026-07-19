package oapiserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
)

func (s *Server) BucketList(w http.ResponseWriter, r *http.Request, params generated.BucketListParams) {
	projectID := strconv.Itoa(params.ProjectId)
	dir := filepath.Join(s.artifactsDir, projectID)
	_ = os.MkdirAll(dir, 0755) // best-effort; subsequent ReadDir will fail if it actually failed

	entries, err := os.ReadDir(dir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"Buckets": []any{}, "Owner": defaultOwner()})
		return
	}

	var buckets []map[string]any
	for _, e := range entries {
		if e.IsDir() {
			info, _ := e.Info()
			created := time.Now()
			if info != nil {
				created = info.ModTime()
			}
			buckets = append(buckets, map[string]any{
				"Name":         e.Name(),
				"CreationDate": created.Format(time.RFC3339),
			})
		}
	}
	if buckets == nil {
		buckets = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"Buckets": buckets, "Owner": defaultOwner()})
}

func (s *Server) ArtifactList(w http.ResponseWriter, r *http.Request, bucket string, params generated.ArtifactListParams) {
	projectID := strconv.Itoa(params.ProjectId)
	dir := filepath.Join(s.artifactsDir, projectID, bucket)
	_ = os.MkdirAll(dir, 0755) // best-effort; subsequent ReadDir will fail if it actually failed

	entries, err := os.ReadDir(dir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"Contents": []any{}, "Name": bucket})
		return
	}

	var contents []map[string]any
	for _, e := range entries {
		if !e.IsDir() {
			info, _ := e.Info()
			size := int64(0)
			modified := time.Now()
			if info != nil {
				size = info.Size()
				modified = info.ModTime()
			}
			contents = append(contents, map[string]any{
				"Key":          e.Name(),
				"Size":         size,
				"LastModified": modified.Format(time.RFC3339),
			})
		}
	}
	if contents == nil {
		contents = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"Contents": contents, "Name": bucket})
}

func (s *Server) CreateBucket(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bucket name required"})
		return
	}

	dir := filepath.Join(s.artifactsDir, projectId, body.Name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": body.Name})
}

func (s *Server) EditBucket(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	var body struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OldName == "" || body.NewName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "old_name and new_name required"})
		return
	}

	oldPath := filepath.Join(s.artifactsDir, projectId, body.OldName)
	newPath := filepath.Join(s.artifactsDir, projectId, body.NewName)
	if err := os.Rename(oldPath, newPath); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": body.NewName})
}

func (s *Server) DeleteBucket(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.DeleteBucketParams) {
	dir := filepath.Join(s.artifactsDir, projectId, params.Name)
	_ = os.RemoveAll(dir) // best-effort delete; response is always 204
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) UpdateBucketPin(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.UpdateBucketPinParams) {
	var body struct {
		Pinned bool `json:"pinned"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // on parse error body is zero-valued (pinned=false), which is safe

	if s.pool != nil {
		_, _ = s.pool.Exec(r.Context(), fmt.Sprintf(
			`INSERT INTO "p_%s".bucket_metadata (name, pinned) VALUES ($1, $2)
			 ON CONFLICT (name) DO UPDATE SET pinned = $2`, projectId),
			params.Name, body.Pinned) // best-effort metadata write
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) CreateArtifact(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, bucket string) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid multipart form"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file field required"})
		return
	}
	defer func() { _ = file.Close() }()

	filename := header.Filename
	if fn := r.FormValue("filename"); fn != "" {
		filename = fn
	}

	dir := filepath.Join(s.artifactsDir, projectId, bucket)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	dst, err := os.Create(filepath.Join(dir, filename))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer func() { _ = dst.Close() }()

	if _, err := io.Copy(dst, file); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) DeleteArtifact(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, bucket string, params generated.DeleteArtifactParams) {
	path := filepath.Join(s.artifactsDir, projectId, bucket, params.Filename)
	_ = os.Remove(path) // best-effort delete; response is always 204
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) DeleteArtifacts(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, bucket string, params generated.DeleteArtifactsParams) {
	if params.Fnames != nil {
		for _, fname := range *params.Fnames {
			path := filepath.Join(s.artifactsDir, projectId, bucket, fname)
			_ = os.Remove(path) // best-effort delete; response is always 204
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func defaultOwner() map[string]any {
	return map[string]any{"DisplayName": "elitea", "ID": "1"}
}
