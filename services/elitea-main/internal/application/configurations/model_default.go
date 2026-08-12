package configurations

// CurrentModelDefaultSelection is the typed internal form of the current
// Configurations default-model Vault update.
type CurrentModelDefaultSelection struct {
	ProjectID       int32
	Name            string
	TargetProjectID int64
	Section         string
}
