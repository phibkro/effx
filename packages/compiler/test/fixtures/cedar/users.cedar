// effx cedar projection of semanticHash {{HASH}}

@id("effx:grant:User.ChangeEmail")
permit (principal == ?principal, action in Effx::Action::"capability/User.ChangeEmail", resource == ?resource);

@id("effx:grant:User.Read")
permit (principal == ?principal, action in Effx::Action::"capability/User.Read", resource == ?resource);
