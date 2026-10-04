// effx cedar projection of semanticHash {{HASH}}

@id("effx:grant:cap \"quoted\" \\ name")
permit (principal == ?principal, action in Effx::Action::"capability/cap \"quoted\" \\ name", resource == ?resource);

@id("effx:grant:cap.a")
permit (principal == ?principal, action in Effx::Action::"capability/cap.a", resource == ?resource);

@id("effx:grant:cap.b")
permit (principal == ?principal, action in Effx::Action::"capability/cap.b", resource == ?resource);

@id("effx:grant:contact.submit")
permit (principal == ?principal, action in Effx::Action::"capability/contact.submit", resource == ?resource);

@id("effx:require:Params.Op:org.member")
forbid (principal, action == Effx::Action::"operation/Params.Op", resource)
unless { context["org.member"] };

@id("effx:require:Params.Op:profile.owner")
forbid (principal, action == Effx::Action::"operation/Params.Op", resource)
unless { context["profile.owner"] };
