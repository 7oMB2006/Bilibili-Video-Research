# Vendored DFSC Candidate

`client.mjs`, `protocol.mjs` and their declarations are unmodified copies from
`7oMB2006/desktop-for-step-code`, commit
`0a03b3f80b497cad3d55531171ace8c7cb381bb3`,
`examples/plugins/host-client/`.

This pin includes stack-safe canonical Base64 validation for large media.
It does not change the wire format, size limits or validation strictness.

`../configuration.mjs` is the unmodified public `json-file-v1` reader from
`examples/plugins/config-starter/plugins/dfsc-config-example/server/` at the
same commit. `LICENSE` applies to these vendored files as well.
The committed Git blobs for the five host-client files and the public
configuration reader were compared byte for byte with that commit.
Windows checkout line endings may differ for the license text.
`../configuration.d.mts` remains BVR's local typing for the public reader.

This is a candidate protocol, not a released-host compatibility promise.
Keep the files and boundary tests together when updating the pinned source.
