package gcs

import "testing"

func TestArtifactCapabilitiesAlwaysReportNoNativeMultipart(t *testing.T) {
	cases := []struct {
		name               string
		hasSigningMaterial bool
		wantPresign        bool
	}{
		{name: "ambient credentials, no signing key", hasSigningMaterial: false, wantPresign: false},
		{name: "service-account credentials file", hasSigningMaterial: true, wantPresign: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := &Backend{hasSigningMaterial: tc.hasSigningMaterial}
			got := b.Capabilities()
			if got.NativeMultipart {
				t.Errorf("Capabilities().NativeMultipart = true, want false (GCS has no multipart API in this client library)")
			}
			if got.Presign != tc.wantPresign {
				t.Errorf("Capabilities().Presign = %v, want %v", got.Presign, tc.wantPresign)
			}
			if !got.ServerSideCopy {
				t.Errorf("Capabilities().ServerSideCopy = false, want true")
			}
		})
	}
}
