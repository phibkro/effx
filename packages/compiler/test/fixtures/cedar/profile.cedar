// effx cedar projection of semanticHash {{HASH}}

@id("effx:grant:profile.read-self")
permit (principal == ?principal, action in Effx::Action::"capability/profile.read-self", resource == ?resource);

@id("effx:grant:profile.update-self")
permit (principal == ?principal, action in Effx::Action::"capability/profile.update-self", resource == ?resource);

@id("effx:require:Profile.Read:profile.owner")
forbid (principal, action == Effx::Action::"operation/Profile.Read", resource)
unless { context["profile.owner"] };

@id("effx:require:Profile.Update:profile.owner")
forbid (principal, action == Effx::Action::"operation/Profile.Update", resource)
unless { context["profile.owner"] };
