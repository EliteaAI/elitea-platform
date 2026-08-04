package azure

import "testing"

func TestArtifactCapabilitiesReflectCredentialPath(t *testing.T) {
	cases := []struct {
		name          string
		usesSharedKey bool
		wantPresign   bool
		wantMultipart bool
	}{
		{name: "no shared key (workload identity)", usesSharedKey: false, wantPresign: false, wantMultipart: false},
		{name: "shared key", usesSharedKey: true, wantPresign: true, wantMultipart: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := &Backend{usesSharedKey: tc.usesSharedKey}
			got := b.Capabilities()
			if got.Presign != tc.wantPresign {
				t.Errorf("Capabilities().Presign = %v, want %v", got.Presign, tc.wantPresign)
			}
			if got.NativeMultipart != tc.wantMultipart {
				t.Errorf("Capabilities().NativeMultipart = %v, want %v", got.NativeMultipart, tc.wantMultipart)
			}
			if !got.ServerSideCopy {
				t.Errorf("Capabilities().ServerSideCopy = false, want true")
			}
		})
	}
}
