import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
import time

service_account_path = 'serviceAccountKey.json'

cred = credentials.Certificate(service_account_path)
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://project-3b15e-default-rtdb.firebaseio.com'  # your actual database URL here
})

ref = db.reference('control')

def update_command(command, location):
    data = {
        'command': command,
        'location': location,
        'id': int(time.time())
    }
    ref.set(data)
    print("Command updated:", data)

if __name__ == "__main__":
    command_input = input("Enter command: ")
    location_input = input("Enter location: ")
    update_command(command_input, location_input)
