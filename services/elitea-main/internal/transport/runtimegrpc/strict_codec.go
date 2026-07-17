package runtimegrpc

import (
	"errors"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

var ErrStrictProto = errors.New("strict protobuf contract violation")

// StrictProtoCodec must be installed independently on the private control and
// output listeners. It applies a listener-specific byte bound before protobuf
// parsing and rejects unknown fields, duplicate singular tags and conflicting
// oneof tags that the default last-value-wins decoder would otherwise erase.
type StrictProtoCodec struct {
	maxMessageBytes int
}

func NewStrictProtoCodec(maxMessageBytes int) (*StrictProtoCodec, error) {
	if maxMessageBytes <= 0 {
		return nil, errors.New("strict protobuf message limit must be positive")
	}
	return &StrictProtoCodec{maxMessageBytes: maxMessageBytes}, nil
}

func (c *StrictProtoCodec) Name() string { return "proto" }

func (c *StrictProtoCodec) Marshal(value any) ([]byte, error) {
	message, ok := value.(proto.Message)
	if !ok {
		return nil, fmt.Errorf("%w: non-protobuf value", ErrStrictProto)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, err
	}
	if len(encoded) > c.maxMessageBytes {
		return nil, fmt.Errorf("%w: encoded message exceeds limit", ErrStrictProto)
	}
	return encoded, nil
}

func (c *StrictProtoCodec) Unmarshal(encoded []byte, value any) error {
	if len(encoded) == 0 || len(encoded) > c.maxMessageBytes {
		return fmt.Errorf("%w: encoded message exceeds limit", ErrStrictProto)
	}
	message, ok := value.(proto.Message)
	if !ok {
		return fmt.Errorf("%w: non-protobuf target", ErrStrictProto)
	}
	if err := ScanStrictMessage(encoded, message.ProtoReflect().Descriptor()); err != nil {
		return err
	}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(encoded, message); err != nil {
		return fmt.Errorf("%w: %v", ErrStrictProto, err)
	}
	return nil
}

func StrictServerOptions(codec *StrictProtoCodec) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.MaxRecvMsgSize(codec.maxMessageBytes),
		grpc.MaxSendMsgSize(codec.maxMessageBytes),
		grpc.ForceServerCodec(codec),
	}
}

func ScanStrictMessage(raw []byte, descriptor protoreflect.MessageDescriptor) error {
	seen := make(map[protoreflect.FieldNumber]struct{}, descriptor.Fields().Len())
	seenOneof := make(map[protoreflect.Name]protoreflect.FieldNumber)
	for len(raw) > 0 {
		number, wireType, tagLength := protowire.ConsumeTag(raw)
		if tagLength < 0 || number <= 0 {
			return ErrStrictProto
		}
		field := descriptor.Fields().ByNumber(number)
		if field == nil {
			return fmt.Errorf("%w: unknown field %d in %s", ErrStrictProto, number, descriptor.FullName())
		}
		if _, duplicate := seen[number]; duplicate && !field.IsList() && !field.IsMap() {
			return fmt.Errorf("%w: duplicate field %d in %s", ErrStrictProto, number, descriptor.FullName())
		}
		seen[number] = struct{}{}
		if oneof := field.ContainingOneof(); oneof != nil && !oneof.IsSynthetic() {
			if previous, exists := seenOneof[oneof.Name()]; exists && previous != number {
				return fmt.Errorf("%w: multiple fields in oneof %s", ErrStrictProto, oneof.FullName())
			}
			seenOneof[oneof.Name()] = number
		}

		value := raw[tagLength:]
		if !wireTypeAllowed(field, wireType) {
			return fmt.Errorf("%w: wrong wire type for %s", ErrStrictProto, field.FullName())
		}
		if field.Kind() == protoreflect.MessageKind {
			nested, length := protowire.ConsumeBytes(value)
			if length < 0 {
				return ErrStrictProto
			}
			if err := ScanStrictMessage(nested, field.Message()); err != nil {
				return err
			}
		}
		valueLength := protowire.ConsumeFieldValue(number, wireType, value)
		if valueLength < 0 {
			return ErrStrictProto
		}
		raw = value[valueLength:]
	}
	return nil
}

func wireTypeAllowed(field protoreflect.FieldDescriptor, wireType protowire.Type) bool {
	switch field.Kind() {
	case protoreflect.BoolKind, protoreflect.EnumKind, protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Uint32Kind, protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Uint64Kind:
		return wireType == protowire.VarintType || (field.IsList() && wireType == protowire.BytesType)
	case protoreflect.Fixed32Kind, protoreflect.Sfixed32Kind, protoreflect.FloatKind:
		return wireType == protowire.Fixed32Type || (field.IsList() && wireType == protowire.BytesType)
	case protoreflect.Fixed64Kind, protoreflect.Sfixed64Kind, protoreflect.DoubleKind:
		return wireType == protowire.Fixed64Type || (field.IsList() && wireType == protowire.BytesType)
	case protoreflect.StringKind, protoreflect.BytesKind, protoreflect.MessageKind:
		return wireType == protowire.BytesType
	default:
		return false
	}
}
