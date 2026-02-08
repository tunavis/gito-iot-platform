"""
Discover available topics on test.mosquitto.org
"""
import paho.mqtt.client as mqtt
import time

discovered_topics = set()

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ Connected to test.mosquitto.org")
        print("🔍 Subscribing to common topics...")
        # Subscribe to common IoT patterns
        client.subscribe("#", qos=0)  # All topics (be careful, can be noisy!)
    else:
        print(f"❌ Connection failed with code {rc}")

def on_message(client, userdata, msg):
    topic = msg.topic
    if topic not in discovered_topics:
        discovered_topics.add(topic)
        try:
            payload = msg.payload.decode('utf-8')
            print(f"\n📡 Topic: {topic}")
            print(f"   Data: {payload[:200]}")  # First 200 chars
        except:
            print(f"\n📡 Topic: {topic}")
            print(f"   Data: [Binary data, {len(msg.payload)} bytes]")

# Connect to public broker
client = mqtt.Client(client_id="gito_discovery")
client.on_connect = on_connect
client.on_message = on_message

print("🚀 Connecting to test.mosquitto.org...")
print("⏱️  Will listen for 30 seconds...\n")

client.connect("test.mosquitto.org", 1883, 60)
client.loop_start()

# Listen for 30 seconds
time.sleep(30)

client.loop_stop()
client.disconnect()

print(f"\n\n📊 Summary: Discovered {len(discovered_topics)} unique topics")
print("\n🎯 Recommended topics for simulation:")
for topic in sorted(discovered_topics)[:20]:  # Show first 20
    print(f"  - {topic}")
