import { FixedMath } from './fixedMath';

// 2D point in fixed-point coordinates
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

// Axis-aligned bounding box
export interface AABB {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// Polygon represented as array of vertices
export type Polygon = ReadonlyArray<Point2D>;

export class GeometryUtils {
  // Create AABB from center, width, height
  static createAABB(centerX: number, centerY: number, width: number, height: number): AABB {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return {
      minX: centerX - halfWidth,
      minY: centerY - halfHeight,
      maxX: centerX + halfWidth,
      maxY: centerY + halfHeight,
    };
  }

  // Rotate point around origin by angle (in millidegrees)
  static rotatePoint(point: Point2D, angleMilli: number): Point2D {
    const cosAngle = FixedMath.cos(angleMilli);
    const sinAngle = FixedMath.sin(angleMilli);

    return {
      x: FixedMath.multiply(point.x, cosAngle, 1000) - FixedMath.multiply(point.y, sinAngle, 1000),
      y: FixedMath.multiply(point.x, sinAngle, 1000) + FixedMath.multiply(point.y, cosAngle, 1000),
    };
  }

  // Create rotated rectangle vertices (centered at origin, then translated)
  static createRotatedRect(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    angleMilli: number
  ): Polygon {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Create rectangle vertices around origin
    const vertices: Point2D[] = [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ];

    // Rotate and translate vertices
    return vertices.map((vertex) => {
      const rotated = GeometryUtils.rotatePoint(vertex, angleMilli);
      return {
        x: rotated.x + centerX,
        y: rotated.y + centerY,
      };
    });
  }

  // Check if two AABBs intersect
  static aabbIntersects(a: AABB, b: AABB): boolean {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  // Calculate intersection area of two AABBs
  static aabbIntersectionArea(a: AABB, b: AABB): number {
    if (!GeometryUtils.aabbIntersects(a, b)) return 0;

    const intersectionWidth = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const intersectionHeight = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);

    return intersectionWidth * intersectionHeight;
  }

  // Calculate polygon area using shoelace formula (fixed-point)
  static polygonArea(polygon: Polygon): number {
    if (polygon.length < 3) return 0;

    let area = 0;
    const n = polygon.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const curr = polygon[i];
      const next = polygon[j];
      if (curr && next) {
        area += curr.x * next.y;
        area -= next.x * curr.y;
      }
    }

    return Math.abs(area) / 2;
  }

  // Sutherland-Hodgman polygon clipping against AABB
  static clipPolygonToAABB(polygon: Polygon, clipRect: AABB): Polygon {
    let clipped: Polygon = [...polygon];

    // Clip against each edge of the rectangle
    clipped = GeometryUtils.clipAgainstEdge(clipped, clipRect.minX, 'left');
    clipped = GeometryUtils.clipAgainstEdge(clipped, clipRect.maxX, 'right');
    clipped = GeometryUtils.clipAgainstEdge(clipped, clipRect.minY, 'bottom');
    clipped = GeometryUtils.clipAgainstEdge(clipped, clipRect.maxY, 'top');

    return clipped;
  }

  // Clip polygon against a single edge
  private static clipAgainstEdge(
    polygon: Polygon,
    edgeValue: number,
    edge: 'left' | 'right' | 'top' | 'bottom'
  ): Polygon {
    if (polygon.length === 0) return [];

    const result: Point2D[] = [];

    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];

      if (!current || !next) continue;

      const currentInside = GeometryUtils.isPointInside(current, edgeValue, edge);
      const nextInside = GeometryUtils.isPointInside(next, edgeValue, edge);

      if (currentInside && nextInside) {
        // Both inside: add next point
        result.push(next);
      } else if (currentInside && !nextInside) {
        // Exiting: add intersection point
        const intersection = GeometryUtils.lineIntersection(current, next, edgeValue, edge);
        if (intersection) result.push(intersection);
      } else if (!currentInside && nextInside) {
        // Entering: add intersection and next point
        const intersection = GeometryUtils.lineIntersection(current, next, edgeValue, edge);
        if (intersection) result.push(intersection);
        result.push(next);
      }
      // Both outside: add nothing
    }

    return result;
  }

  private static isPointInside(
    point: Point2D,
    edgeValue: number,
    edge: 'left' | 'right' | 'top' | 'bottom'
  ): boolean {
    switch (edge) {
      case 'left':
        return point.x >= edgeValue;
      case 'right':
        return point.x <= edgeValue;
      case 'bottom':
        return point.y >= edgeValue;
      case 'top':
        return point.y <= edgeValue;
    }
  }

  private static lineIntersection(
    p1: Point2D,
    p2: Point2D,
    edgeValue: number,
    edge: 'left' | 'right' | 'top' | 'bottom'
  ): Point2D | null {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    switch (edge) {
      case 'left':
      case 'right': {
        if (dx === 0) return null; // Vertical line
        const t = FixedMath.divide(edgeValue - p1.x, dx, 1000);
        return {
          x: edgeValue,
          y: p1.y + FixedMath.multiply(dy, t, 1000),
        };
      }
      case 'top':
      case 'bottom': {
        if (dy === 0) return null; // Horizontal line
        const t = FixedMath.divide(edgeValue - p1.y, dy, 1000);
        return {
          x: p1.x + FixedMath.multiply(dx, t, 1000),
          y: edgeValue,
        };
      }
    }
  }
}
