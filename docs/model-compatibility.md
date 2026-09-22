# Model Compatibility Test History

This document records exploratory model tests separately from the project's
stable defaults. A model appearing here does not mean that it is a recommended
provider, a fully supported mode, or a production-quality replacement.

## Status vocabulary

- `default`: used by the documented stable path.
- `interface-compatible`: accepted the request shape used by this MCP.
- `vision-only`: visual input worked, but language or multimodal support was not
  established.
- `experimental`: tested for compatibility or behavior, but not benchmarked
  sufficiently for default use.
- `pending`: not tested yet.

## Stable defaults

| Capability | Default model | Channel |
| --- | --- | --- |
| Video understanding | `step-3.7-flash` | StepFun Open Platform or Step Plan |
| No-caption ASR fallback | `stepaudio-2.5-asr` | StepFun Open Platform or Step Plan |

These defaults remain unchanged when newer models are added to the compatibility
record.

## Test records

### 2026-08-30 — GLM-5.3-Flash (Z.AI)

| Field | Result |
| --- | --- |
| Capability | Video-frame understanding |
| Result | `vision-only` / `experimental` |
| Evidence | The model identified video frames and visible text in the tested request path |
| Limitation | An isolated test with a valid audio track did not establish audio understanding |
| Position | Historical experiment; not a documented provider configuration |

This experiment does not establish `language` or full `multimodal` support for
the project and does not change StepFun's default status.

### 2026-09-22 — StepFun `step-5-preview`

| Field | Result |
| --- | --- |
| Capability | Video understanding |
| Channel | Step Plan |
| Request path | Chat Completions with `video_url` |
| Result | `interface-compatible` |
| Evidence | A minimal video request returned HTTP 200 and the expected model response |
| Position | Optional compatibility test; not the default |

The current adapter can select this model through:

```env
STEPFUN_VIDEO_MODEL=step-5-preview
```

### 2026-09-22 — StepFun `stepaudio-3-asr-max`

| Field | Result |
| --- | --- |
| Capability | ASR |
| Channel | Official Open Platform API |
| Request path | `/audio/asr/sse` |
| Result | `interface-compatible`, transcription quality not benchmarked |
| Evidence | The model was accepted by the existing request shape and returned HTTP 200 |
| Position | Optional compatibility test; not the default |

This test uses a different channel from the Step Plan configuration:

```env
STEPFUN_BASE_URL=https://api.stepfun.com/v1
STEPFUN_ASR_MODEL=stepaudio-3-asr-max
```

Do not mix credentials or Base URLs between the two channels.

## Pending candidates

| Candidate | Planned check |
| --- | --- |
| Xiaomi MiMo Pro 2.6 family | Verify the exact model ID, video/audio input format, endpoint, and whether it can cover the BVR language, vision, or multimodal paths |

For every future record, distinguish request compatibility from actual research
quality. A successful HTTP response alone is not a quality benchmark.
