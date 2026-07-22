export const IDENTITY_MAT4 = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
];
export function isMat4(m) {
    return m.length === 16 && m.every((v) => Number.isFinite(v));
}
function at(m, row, col) {
    const v = m[col * 4 + row];
    if (v === undefined) {
        throw new Error("Matrix must have 16 elements");
    }
    return v;
}
/** Apply a column-major 4×4 transform to a 3D point (w = 1). */
export function applyTransform(m, p) {
    if (!isMat4(m)) {
        throw new Error("Transform must be a finite 16-element column-major matrix");
    }
    return {
        x: at(m, 0, 0) * p.x + at(m, 0, 1) * p.y + at(m, 0, 2) * p.z + at(m, 0, 3),
        y: at(m, 1, 0) * p.x + at(m, 1, 1) * p.y + at(m, 1, 2) * p.z + at(m, 1, 3),
        z: at(m, 2, 0) * p.x + at(m, 2, 1) * p.y + at(m, 2, 2) * p.z + at(m, 2, 3)
    };
}
/** Multiply two column-major matrices: result = a · b. */
export function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
            let sum = 0;
            for (let k = 0; k < 4; k += 1) {
                sum += at(a, r, k) * at(b, k, c);
            }
            out[c * 4 + r] = sum;
        }
    }
    return out;
}
/**
 * Sanity checks for an imported source transform: finite, affine bottom row,
 * and a rotation/scale block whose determinant is positive and not degenerate.
 */
export function transformSanity(m) {
    const reasons = [];
    if (!isMat4(m)) {
        return { ok: false, reasons: ["matrix_not_finite_16_elements"] };
    }
    const bottom = [at(m, 3, 0), at(m, 3, 1), at(m, 3, 2), at(m, 3, 3)];
    if (Math.abs(bottom[0]) > 1e-6 || Math.abs(bottom[1]) > 1e-6 || Math.abs(bottom[2]) > 1e-6) {
        reasons.push("bottom_row_not_affine");
    }
    if (Math.abs(bottom[3] - 1) > 1e-6) {
        reasons.push("bottom_right_not_one");
    }
    const det = at(m, 0, 0) * (at(m, 1, 1) * at(m, 2, 2) - at(m, 1, 2) * at(m, 2, 1)) -
        at(m, 0, 1) * (at(m, 1, 0) * at(m, 2, 2) - at(m, 1, 2) * at(m, 2, 0)) +
        at(m, 0, 2) * (at(m, 1, 0) * at(m, 2, 1) - at(m, 1, 1) * at(m, 2, 0));
    if (!(det > 1e-9)) {
        reasons.push("linear_block_degenerate_or_mirrored");
    }
    return { ok: reasons.length === 0, reasons };
}
//# sourceMappingURL=transform.js.map