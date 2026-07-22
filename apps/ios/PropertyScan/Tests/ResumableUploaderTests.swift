import XCTest
@testable import PropertyScan

final class ResumableUploaderTests: XCTestCase {
    func testPartCountMath() {
        let mib = 1024 * 1024
        XCTAssertEqual(ResumableUploader.partCount(forByteSize: 1, partSizeBytes: 8 * mib), 1)
        XCTAssertEqual(ResumableUploader.partCount(forByteSize: 8 * mib, partSizeBytes: 8 * mib), 1)
        XCTAssertEqual(ResumableUploader.partCount(forByteSize: 8 * mib + 1, partSizeBytes: 8 * mib), 2)
        XCTAssertEqual(ResumableUploader.partCount(forByteSize: 25 * mib, partSizeBytes: 8 * mib), 4)
    }

    func testByteRangesTileTheWholePayloadWithoutOverlap() {
        let byteSize = 20_000_000
        let partSize = 8 * 1024 * 1024
        let parts = ResumableUploader.partCount(forByteSize: byteSize, partSizeBytes: partSize)
        var covered = 0
        var previousEnd = 0
        for n in 1...parts {
            let range = ResumableUploader.byteRange(
                forPart: n, byteSize: byteSize, partSizeBytes: partSize
            )
            XCTAssertEqual(range.lowerBound, previousEnd)
            previousEnd = range.upperBound
            covered += range.count
        }
        XCTAssertEqual(covered, byteSize)
        XCTAssertEqual(previousEnd, byteSize)
    }
}
